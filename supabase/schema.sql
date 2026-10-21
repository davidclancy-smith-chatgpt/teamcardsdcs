-- =====================================================================
-- Team Cards — Supabase database setup
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run once on a fresh project.
-- BEFORE RUNNING: change 'change-me' at the very bottom to your team code.
-- =====================================================================

-- ---------- Tables -------------------------------------------------------

create table if not exists public.app_settings (
  id            int primary key default 1 check (id = 1),
  create_code   text not null
);

create table if not exists public.cards (
  id                 uuid primary key,
  occasion           text not null default 'Birthday',
  recipient_name     text not null,
  recipient_email    text not null,
  headline           text,
  cover_url          text,
  organiser_name     text not null,
  organiser_email    text not null,
  deadline           timestamptz not null,
  send_at            timestamptz,
  status             text not null default 'collecting'
                     check (status in ('collecting','ready','scheduled','sent')),
  manage_token       text not null unique,
  view_token         text not null unique,
  open_token         text not null unique,
  open_link_enabled  boolean not null default true,
  ready_notified_at  timestamptz,
  sent_at            timestamptz,
  thank_you          text,
  thank_you_at       timestamptz,
  delete_after       timestamptz,
  created_at         timestamptz not null default now()
);

create table if not exists public.invitees (
  id           uuid primary key default gen_random_uuid(),
  card_id      uuid not null references public.cards(id) on delete cascade,
  name         text,
  email        text not null,
  token        text not null unique,
  source       text not null default 'list' check (source in ('list','open')),
  invited_at   timestamptz,
  reminded_at  timestamptz,
  signed_at    timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists invitees_card_email on public.invitees (card_id, lower(email));

create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  card_id      uuid not null references public.cards(id) on delete cascade,
  invitee_id   uuid not null unique references public.invitees(id) on delete cascade,
  author_name  text not null,
  body         text not null default '',
  font         text not null default 'Caveat',
  colour       text not null default '#1f2937',
  media_url    text,
  media_kind   text check (media_kind in ('image','gif')),
  hidden       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.outbox (
  id          bigserial primary key,
  card_id     uuid references public.cards(id) on delete cascade,
  kind        text not null,
  to_email    text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    int not null default 0,
  error       text
);
create index if not exists outbox_pending on public.outbox (id) where sent_at is null;

-- Lock every table: the public key cannot read or write them directly.
-- All access goes through the functions below, which check the secret links.
alter table public.app_settings enable row level security;
alter table public.cards        enable row level security;
alter table public.invitees     enable row level security;
alter table public.messages     enable row level security;
alter table public.outbox       enable row level security;

-- ---------- Helpers --------------------------------------------------------

create or replace function public.tc_token() returns text
language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

create or replace function public.tc_clean_email(e text) returns text
language sql immutable as $$
  select lower(trim(e))
$$;

create or replace function public.tc_valid_email(e text) returns boolean
language sql immutable as $$
  select e ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
$$;

create or replace function public.tc_enqueue(p_card uuid, p_kind text, p_to text, p_payload jsonb)
returns void language sql as $$
  insert into public.outbox (card_id, kind, to_email, payload)
  values (p_card, p_kind, p_to, p_payload);
$$;

-- What every email needs to know about its card.
create or replace function public.tc_card_payload(c public.cards) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'recipient_name', c.recipient_name,
    'occasion',       c.occasion,
    'headline',       c.headline,
    'cover_url',      c.cover_url,
    'organiser_name', c.organiser_name,
    'deadline',       c.deadline
  )
$$;

create or replace function public.tc_invite(c public.cards, p_email text, p_name text, p_source text)
returns public.invitees language plpgsql as $$
declare
  v public.invitees;
begin
  insert into public.invitees (card_id, email, name, token, source, invited_at)
  values (c.id, tc_clean_email(p_email), nullif(trim(p_name), ''), tc_token(), p_source,
          case when p_source = 'list' then now() end)
  on conflict (card_id, lower(email)) do nothing
  returning * into v;
  if v.id is not null and p_source = 'list' then
    perform tc_enqueue(c.id, 'invite', v.email,
      tc_card_payload(c) || jsonb_build_object('link', 's=' || v.token));
  end if;
  return v;
end $$;

-- The message list as people see it.
create or replace function public.tc_messages(p_card uuid, p_include_hidden boolean)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'author_name', m.author_name, 'body', m.body,
           'font', m.font, 'colour', m.colour, 'media_url', m.media_url,
           'media_kind', m.media_kind, 'hidden', m.hidden,
           'invitee_id', m.invitee_id, 'updated_at', m.updated_at)
         order by m.created_at), '[]'::jsonb)
  from public.messages m
  where m.card_id = p_card and (p_include_hidden or not m.hidden)
$$;

create or replace function public.tc_card_public(c public.cards) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', c.id, 'occasion', c.occasion, 'recipient_name', c.recipient_name,
    'headline', c.headline, 'cover_url', c.cover_url,
    'organiser_name', c.organiser_name, 'deadline', c.deadline,
    'status', c.status, 'sent_at', c.sent_at,
    'thank_you', c.thank_you)
$$;

-- ---------- Organiser ------------------------------------------------------

create or replace function public.create_card(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.cards;
  e text;
  n int := 0;
begin
  if coalesce(p->>'code', '') <> (select create_code from app_settings where id = 1) then
    raise exception 'That team code is not right.';
  end if;
  if not tc_valid_email(tc_clean_email(p->>'organiser_email')) then
    raise exception 'Please enter a valid email for yourself.';
  end if;
  if not tc_valid_email(tc_clean_email(p->>'recipient_email')) then
    raise exception 'Please enter a valid email for the recipient.';
  end if;
  if coalesce(trim(p->>'recipient_name'), '') = '' or coalesce(trim(p->>'organiser_name'), '') = '' then
    raise exception 'Please fill in both names.';
  end if;
  if (p->>'deadline')::timestamptz <= now() then
    raise exception 'The deadline needs to be in the future.';
  end if;
  if jsonb_array_length(coalesce(p->'emails', '[]'::jsonb)) > 80 then
    raise exception 'Up to 80 people per card, please.';
  end if;

  insert into cards (id, occasion, recipient_name, recipient_email, headline, cover_url,
                     organiser_name, organiser_email, deadline,
                     manage_token, view_token, open_token)
  values ((p->>'id')::uuid,
          left(coalesce(nullif(trim(p->>'occasion'), ''), 'Birthday'), 40),
          left(trim(p->>'recipient_name'), 80),
          tc_clean_email(p->>'recipient_email'),
          left(nullif(trim(p->>'headline'), ''), 120),
          nullif(p->>'cover_url', ''),
          left(trim(p->>'organiser_name'), 80),
          tc_clean_email(p->>'organiser_email'),
          (p->>'deadline')::timestamptz,
          tc_token(), tc_token(), tc_token())
  returning * into c;

  -- The organiser gets their private manage link by email, so it can't be lost.
  perform tc_enqueue(c.id, 'organiser', c.organiser_email,
    tc_card_payload(c) || jsonb_build_object('link', 'm=' || c.manage_token));

  if coalesce((p->>'include_me')::boolean, false) then
    perform tc_invite(c, c.organiser_email, c.organiser_name, 'list');
  end if;

  for e in select jsonb_array_elements_text(coalesce(p->'emails', '[]'::jsonb)) loop
    e := tc_clean_email(e);
    if tc_valid_email(e) and e <> c.recipient_email then
      perform tc_invite(c, e, null, 'list');
      n := n + 1;
    end if;
  end loop;

  return jsonb_build_object('manage_token', c.manage_token, 'invited', n);
end $$;

create or replace function public.get_manage(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cards;
begin
  select * into c from cards where manage_token = p_token;
  if c.id is null then raise exception 'This manage link is not valid.'; end if;
  return tc_card_public(c) || jsonb_build_object(
    'recipient_email', c.recipient_email,
    'organiser_email', c.organiser_email,
    'send_at', c.send_at,
    'open_token', c.open_token,
    'open_link_enabled', c.open_link_enabled,
    'view_token', case when c.status = 'sent' then c.view_token end,
    'invitees', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', i.id, 'email', i.email, 'name', i.name, 'source', i.source,
                   'signed_at', i.signed_at, 'reminded_at', i.reminded_at)
                   order by i.signed_at nulls last, i.email), '[]'::jsonb)
                 from invitees i where i.card_id = c.id),
    'messages', tc_messages(c.id, true));
end $$;

create or replace function public.update_card(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cards;
begin
  select * into c from cards where manage_token = p_token;
  if c.id is null then raise exception 'This manage link is not valid.'; end if;
  if c.status = 'sent' then raise exception 'This card has already been sent.'; end if;
  update cards set
    headline          = case when p ? 'headline' then left(nullif(trim(p->>'headline'), ''), 120) else headline end,
    cover_url         = case when p ? 'cover_url' then nullif(p->>'cover_url', '') else cover_url end,
    deadline          = case when p ? 'deadline' then (p->>'deadline')::timestamptz else deadline end,
    open_link_enabled = case when p ? 'open_link_enabled' then (p->>'open_link_enabled')::boolean else open_link_enabled end,
    -- a new later deadline re-opens a card that was marked ready
    status            = case when p ? 'deadline' and status = 'ready' and (p->>'deadline')::timestamptz > now()
                             then 'collecting' else status end,
    ready_notified_at = case when p ? 'deadline' and status = 'ready' and (p->>'deadline')::timestamptz > now()
                             then null else ready_notified_at end
  where id = c.id;
  return get_manage(p_token);
end $$;

create or replace function public.add_invitees(p_token text, p_emails jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cards; e text;
begin
  select * into c from cards where manage_token = p_token;
  if c.id is null then raise exception 'This manage link is not valid.'; end if;
  if c.status = 'sent' then raise exception 'This card has already been sent.'; end if;
  if (select count(*) from invitees where card_id = c.id) + jsonb_array_length(p_emails) > 120 then
    raise exception 'That would take the card over 120 people.';
  end if;
  for e in select jsonb_array_elements_text(p_emails) loop
    e := tc_clean_email(e);
    if tc_valid_email(e) and e <> c.recipient_email then
      perform tc_invite(c, e, null, 'list');
    end if;
  end loop;
  return get_manage(p_token);
end $$;

create or replace function public.nudge(p_token text, p_invitee uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cards; i public.invitees;
begin
  select * into c from cards where manage_token = p_token;
  if c.id is null then raise exception 'This manage link is not valid.'; end if;
  select * into i from invitees where id = p_invitee and card_id = c.id;
  if i.id is null then raise exception 'Person not found.'; end if;
  if i.signed_at is not null then raise exception 'They have already signed.'; end if;
  if i.reminded_at is not null and i.reminded_at > now() - interval '12 hours' then
    raise exception 'They were reminded in the last 12 hours.';
  end if;
  update invitees set reminded_at = now() where id = i.id;
  perform tc_enqueue(c.id, 'reminder', i.email,
    tc_card_payload(c) || jsonb_build_object('link', 's=' || i.token));
  return get_manage(p_token);
end $$;

create or replace function public.set_hidden(p_token text, p_message uuid, p_hidden boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cards;
begin
  select * into c from cards where manage_token = p_token;
  if c.id is null then raise exception 'This manage link is not valid.'; end if;
  update messages set hidden = p_hidden where id = p_message and card_id = c.id;
  return get_manage(p_token);
end $$;

-- Send now (p_send_at null or in the past) or at a set time.
create or replace function public.schedule_send(p_token text, p_send_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cards;
begin
  select * into c from cards where manage_token = p_token;
  if c.id is null then raise exception 'This manage link is not valid.'; end if;
  if c.status = 'sent' then raise exception 'This card has already been sent.'; end if;
  if not exists (select 1 from messages where card_id = c.id and not hidden) then
    raise exception 'Nobody has signed yet.';
  end if;
  update cards set status = 'scheduled', send_at = greatest(coalesce(p_send_at, now()), now())
  where id = c.id;
  return get_manage(p_token);
end $$;

create or replace function public.cancel_send(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cards;
begin
  select * into c from cards where manage_token = p_token;
  if c.id is null then raise exception 'This manage link is not valid.'; end if;
  if c.status <> 'scheduled' then raise exception 'This card is not scheduled.'; end if;
  update cards set status = case when ready_notified_at is not null then 'ready' else 'collecting' end,
                   send_at = null
  where id = c.id;
  return get_manage(p_token);
end $$;

-- ---------- Signers --------------------------------------------------------

create or replace function public.get_sign(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.invitees; c public.cards; m public.messages;
begin
  select * into i from invitees where token = p_token;
  if i.id is null then raise exception 'This signing link is not valid.'; end if;
  select * into c from cards where id = i.card_id;
  select * into m from messages where invitee_id = i.id;
  return jsonb_build_object(
    'card', tc_card_public(c),
    'me', jsonb_build_object('name', i.name, 'email', i.email),
    'mine', case when m.id is null then null else jsonb_build_object(
              'id', m.id, 'author_name', m.author_name, 'body', m.body, 'font', m.font,
              'colour', m.colour, 'media_url', m.media_url, 'media_kind', m.media_kind) end,
    'messages', (select coalesce(jsonb_agg(x), '[]'::jsonb)
                 from jsonb_array_elements(tc_messages(c.id, false)) x
                 where (x->>'invitee_id')::uuid <> i.id));
end $$;

create or replace function public.save_message(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i public.invitees; c public.cards;
  v_font text := coalesce(p->>'font', 'Caveat');
  v_colour text := coalesce(p->>'colour', '#1f2937');
  v_media text := nullif(p->>'media_url', '');
  v_kind text := nullif(p->>'media_kind', '');
  v_name text := left(trim(coalesce(p->>'author_name', '')), 60);
  v_body text := left(coalesce(p->>'body', ''), 1000);
begin
  select * into i from invitees where token = p_token;
  if i.id is null then raise exception 'This signing link is not valid.'; end if;
  select * into c from cards where id = i.card_id;
  if c.status = 'sent' then raise exception 'This card has already been sent, so it can''t be changed.'; end if;
  if v_name = '' then raise exception 'Please add your name.'; end if;
  if trim(v_body) = '' and v_media is null then raise exception 'Please write a message or add a picture.'; end if;
  if v_font not in ('Caveat','Dancing Script','Patrick Hand','Permanent Marker','Pacifico','Nunito') then
    v_font := 'Caveat';
  end if;
  if v_colour !~ '^#[0-9a-fA-F]{6}$' then v_colour := '#1f2937'; end if;
  if v_media is not null and not (
       v_media ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/media/'
    or v_media ~ '^https://(media[0-9]*|i)\.giphy\.com/') then
    raise exception 'That picture link is not allowed.';
  end if;
  if v_media is null then v_kind := null;
  elsif v_kind not in ('image','gif') then v_kind := 'image'; end if;

  insert into messages (card_id, invitee_id, author_name, body, font, colour, media_url, media_kind)
  values (c.id, i.id, v_name, v_body, v_font, v_colour, v_media, v_kind)
  on conflict (invitee_id) do update set
    author_name = excluded.author_name, body = excluded.body, font = excluded.font,
    colour = excluded.colour, media_url = excluded.media_url, media_kind = excluded.media_kind,
    updated_at = now();
  update invitees set signed_at = coalesce(signed_at, now()), name = v_name where id = i.id;
  return get_sign(p_token);
end $$;

create or replace function public.delete_message(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.invitees; c public.cards;
begin
  select * into i from invitees where token = p_token;
  if i.id is null then raise exception 'This signing link is not valid.'; end if;
  select * into c from cards where id = i.card_id;
  if c.status = 'sent' then raise exception 'This card has already been sent, so it can''t be changed.'; end if;
  delete from messages where invitee_id = i.id;
  update invitees set signed_at = null where id = i.id;
  return get_sign(p_token);
end $$;

-- Latecomers: the optional open link.
create or replace function public.get_open(p_open text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cards;
begin
  select * into c from cards where open_token = p_open;
  if c.id is null or not c.open_link_enabled or c.status = 'sent' then
    raise exception 'This link is closed. Ask the organiser for an invite.';
  end if;
  return tc_card_public(c);
end $$;

create or replace function public.join_open(p_open text, p_name text, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cards; i public.invitees; e text := tc_clean_email(p_email);
begin
  select * into c from cards where open_token = p_open;
  if c.id is null or not c.open_link_enabled or c.status = 'sent' then
    raise exception 'This link is closed. Ask the organiser for an invite.';
  end if;
  if not tc_valid_email(e) then raise exception 'Please enter a valid email.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Please add your name.'; end if;
  if e = c.recipient_email then raise exception 'That''s the recipient''s email, so no peeking!'; end if;
  select * into i from invitees where card_id = c.id and lower(email) = e;
  if i.id is not null then
    -- Already on the card: email them their own link rather than handing it out here.
    if i.invited_at is null or i.invited_at < now() - interval '10 minutes' then
      update invitees set invited_at = now() where id = i.id;
      perform tc_enqueue(c.id, 'invite', i.email,
        tc_card_payload(c) || jsonb_build_object('link', 's=' || i.token));
    end if;
    return jsonb_build_object('emailed', true);
  end if;
  if (select count(*) from invitees where card_id = c.id) >= 120 then
    raise exception 'This card is full.';
  end if;
  i := tc_invite(c, e, p_name, 'open');
  return jsonb_build_object('token', i.token);
end $$;

-- ---------- Recipient ------------------------------------------------------

create or replace function public.get_view(p_view text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cards;
begin
  select * into c from cards where view_token = p_view and status = 'sent';
  if c.id is null then raise exception 'This card link is not valid.'; end if;
  return jsonb_build_object('card', tc_card_public(c), 'messages', tc_messages(c.id, false));
end $$;

create or replace function public.post_thanks(p_view text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cards; i record;
begin
  select * into c from cards where view_token = p_view and status = 'sent';
  if c.id is null then raise exception 'This card link is not valid.'; end if;
  if c.thank_you is not null then raise exception 'You''ve already sent your thank-you.'; end if;
  if coalesce(trim(p_text), '') = '' then raise exception 'Please write a message.'; end if;
  update cards set thank_you = left(trim(p_text), 1000), thank_you_at = now() where id = c.id
  returning * into c;
  for i in select distinct email from invitees where card_id = c.id and signed_at is not null
           union select c.organiser_email loop
    perform tc_enqueue(c.id, 'thanks', i.email,
      tc_card_payload(c) || jsonb_build_object('thank_you', c.thank_you));
  end loop;
  return get_view(p_view);
end $$;

-- ---------- Worker (Gmail Apps Script, secret key only) --------------------

-- Moves cards along: reminders, ready notices, scheduled sends.
-- Returns the ids of expired cards whose files the worker should delete.
create or replace function public.worker_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cards; i public.invitees; v_purge jsonb;
begin
  -- 1. Reminder two days before the deadline, once, to people who haven't signed.
  for i in
    select iv.* from invitees iv join cards cd on cd.id = iv.card_id
    where cd.status in ('collecting','ready')
      and cd.deadline > now() and cd.deadline <= now() + interval '2 days'
      and iv.signed_at is null and iv.reminded_at is null
      and iv.created_at < now() - interval '12 hours'
  loop
    select * into c from cards where id = i.card_id;
    update invitees set reminded_at = now() where id = i.id;
    perform tc_enqueue(c.id, 'reminder', i.email,
      tc_card_payload(c) || jsonb_build_object('link', 's=' || i.token));
  end loop;

  -- 2. Ready: everyone on the list has signed, or the deadline has passed.
  for c in
    select cd.* from cards cd
    where cd.status = 'collecting' and cd.ready_notified_at is null
      and (cd.deadline <= now()
           or (exists (select 1 from invitees where card_id = cd.id)
               and not exists (select 1 from invitees
                               where card_id = cd.id and source = 'list' and signed_at is null)))
  loop
    update cards set status = 'ready', ready_notified_at = now() where id = c.id;
    perform tc_enqueue(c.id, 'ready', c.organiser_email,
      tc_card_payload(c) || jsonb_build_object(
        'link', 'm=' || c.manage_token,
        'signed', (select count(*) from invitees where card_id = c.id and signed_at is not null),
        'total',  (select count(*) from invitees where card_id = c.id),
        'reason', case when c.deadline <= now() then 'deadline' else 'all_signed' end));
  end loop;

  -- 3. Deliver scheduled cards.
  for c in select * from cards where status = 'scheduled' and send_at <= now() loop
    update cards set status = 'sent', sent_at = now(), delete_after = now() + interval '90 days'
    where id = c.id returning * into c;
    perform tc_enqueue(c.id, 'delivery', c.recipient_email,
      tc_card_payload(c) || jsonb_build_object('link', 'v=' || c.view_token,
        'count', (select count(*) from messages where card_id = c.id and not hidden)));
    perform tc_enqueue(c.id, 'delivered', c.organiser_email,
      tc_card_payload(c) || jsonb_build_object('link', 'm=' || c.manage_token));
  end loop;

  -- 4. Cards past their 90 days.
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_purge
  from cards where delete_after is not null and delete_after < now();

  -- Keep the outbox tidy.
  delete from outbox where sent_at < now() - interval '30 days';

  return jsonb_build_object('purge', v_purge);
end $$;

create or replace function public.worker_outbox(p_limit int) returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'kind', o.kind, 'to', o.to_email, 'payload', o.payload)
         order by o.id), '[]'::jsonb)
  from (select * from outbox where sent_at is null and attempts < 5
        order by id limit p_limit) o
$$;

create or replace function public.worker_mark(p_id bigint, p_error text) returns void
language sql security definer set search_path = public as $$
  update outbox set
    sent_at  = case when p_error is null then now() else sent_at end,
    attempts = attempts + 1,
    error    = p_error
  where id = p_id;
$$;

create or replace function public.worker_purge(p_card uuid) returns void
language sql security definer set search_path = public as $$
  delete from cards where id = p_card and delete_after < now();
$$;

-- ---------- Permissions ----------------------------------------------------

revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.create_card(jsonb), public.get_manage(text), public.update_card(text, jsonb),
  public.add_invitees(text, jsonb), public.nudge(text, uuid),
  public.set_hidden(text, uuid, boolean), public.schedule_send(text, timestamptz),
  public.cancel_send(text), public.get_sign(text), public.save_message(text, jsonb),
  public.delete_message(text), public.get_open(text), public.join_open(text, text, text),
  public.get_view(text), public.post_thanks(text, text)
to anon, authenticated;

grant execute on function
  public.worker_tick(), public.worker_outbox(int), public.worker_mark(bigint, text),
  public.worker_purge(uuid)
to service_role;

-- ---------- Picture storage ------------------------------------------------

-- Public bucket for covers and photos: images only, 6 MB max each.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 6291456,
        array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do nothing;

drop policy if exists "team cards upload" on storage.objects;
create policy "team cards upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = 'cards');

-- ---------- Your team code -------------------------------------------------
-- Anyone creating a card must type this code. Change 'change-me' before running.
insert into public.app_settings (id, create_code) values (1, 'change-me')
on conflict (id) do update set create_code = excluded.create_code;
