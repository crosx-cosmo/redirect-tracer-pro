alter table public.short_links add column if not exists rules jsonb not null default '[]'::jsonb;

create table public.link_clicks (
  id bigserial primary key,
  link_id uuid not null references public.short_links(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  visitor_hash text not null,
  referrer_host text,
  country text,
  region text,
  device text,
  browser text,
  os text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  is_bot boolean not null default false,
  rule_id text
);
grant all on public.link_clicks to service_role;
grant usage, select on sequence public.link_clicks_id_seq to service_role;
alter table public.link_clicks enable row level security;
create index link_clicks_link_time_idx on public.link_clicks (link_id, clicked_at desc);

create table public.monitors (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null,
  url text not null check (url ~* '^https?://' and length(url) <= 2048),
  label text check (length(label) <= 80),
  interval_minutes int not null default 60 check (interval_minutes in (5,15,30,60,360,1440)),
  webhook_url text check (webhook_url is null or (webhook_url ~* '^https://' and length(webhook_url) <= 2048)),
  enabled boolean not null default true,
  state text not null default 'pending',
  last_checked_at timestamptz,
  next_check_at timestamptz not null default now(),
  last_final_url text,
  last_status int,
  last_hops int,
  last_ms int,
  avg_ms int,
  last_error text,
  last_alert_at timestamptz,
  last_alert_key text,
  created_at timestamptz not null default now()
);
grant all on public.monitors to service_role;
alter table public.monitors enable row level security;
create index monitors_owner_idx on public.monitors (owner_hash);
create index monitors_due_idx on public.monitors (next_check_at) where enabled;

create table public.monitor_checks (
  id bigserial primary key,
  monitor_id uuid not null references public.monitors(id) on delete cascade,
  checked_at timestamptz not null default now(),
  state text not null,
  status int,
  final_url text,
  hops int,
  ms int,
  https boolean,
  loop boolean,
  error text,
  changes text[] not null default '{}'
);
grant all on public.monitor_checks to service_role;
grant usage, select on sequence public.monitor_checks_id_seq to service_role;
alter table public.monitor_checks enable row level security;
create index monitor_checks_monitor_time_idx on public.monitor_checks (monitor_id, checked_at desc);

drop function if exists public.list_short_links(text);
create function public.list_short_links(p_owner text)
returns table (id uuid, slug text, destination text, enabled boolean, clicks bigint, last_clicked_at timestamptz, created_at timestamptz, expires_at timestamptz, rules jsonb)
language sql security definer set search_path = public, extensions as $$
  select id, slug, destination, enabled, clicks, last_clicked_at, created_at, expires_at, rules
  from short_links where owner_hash = public._sl_hash(p_owner) order by created_at desc limit 500
$$;

create or replace function public.get_redirect_target(p_slug text)
returns table (id uuid, destination text, rules jsonb)
language sql stable security definer set search_path = public as $$
  select id, destination, rules from short_links
  where slug = p_slug and enabled and (expires_at is null or expires_at > now())
$$;

create or replace function public.record_link_click(
  p_link_id uuid, p_visitor text, p_referrer text, p_country text, p_region text,
  p_device text, p_browser text, p_os text, p_utm_source text, p_utm_medium text,
  p_utm_campaign text, p_is_bot boolean, p_rule text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update short_links set clicks = clicks + 1, last_clicked_at = now() where id = p_link_id;
  if not found then return; end if;
  insert into link_clicks (link_id, visitor_hash, referrer_host, country, region, device, browser, os,
    utm_source, utm_medium, utm_campaign, is_bot, rule_id)
  values (p_link_id, left(coalesce(p_visitor,''), 64), left(p_referrer, 120), left(p_country, 8), left(p_region, 80),
    left(p_device, 20), left(p_browser, 40), left(p_os, 40), left(p_utm_source, 100), left(p_utm_medium, 100),
    left(p_utm_campaign, 100), coalesce(p_is_bot, false), left(p_rule, 64));
end $$;

create or replace function public.set_short_link_rules(p_id uuid, p_owner text, p_rules jsonb)
returns boolean language sql security definer set search_path = public, extensions as $$
  with u as (update short_links set rules = coalesce(p_rules, '[]'::jsonb)
    where id = p_id and owner_hash = public._sl_hash(p_owner) and jsonb_typeof(coalesce(p_rules,'[]'::jsonb)) = 'array'
    returning 1)
  select exists(select 1 from u)
$$;

create or replace function public.link_analytics(p_id uuid, p_owner text, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare ok boolean; res jsonb;
begin
  select exists(select 1 from short_links where id = p_id and owner_hash = public._sl_hash(p_owner)) into ok;
  if not ok then return null; end if;
  with c as (select * from link_clicks where link_id = p_id and clicked_at >= p_from and clicked_at < p_to)
  select jsonb_build_object(
    'total', (select count(*) from c),
    'unique', (select count(distinct visitor_hash) from c),
    'bots', (select count(*) from c where is_bot),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'clicks', n, 'unique', u) order by d)
       from (select date_trunc('day', clicked_at)::date d, count(*) n, count(distinct visitor_hash) u from c group by 1) t), '[]'),
    'referrers', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n)) from (select coalesce(referrer_host,'Direct') k, count(*) n from c group by 1 order by 2 desc limit 10) t), '[]'),
    'countries', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n)) from (select coalesce(country,'Unknown') k, count(*) n from c group by 1 order by 2 desc limit 10) t), '[]'),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n)) from (select coalesce(device,'Unknown') k, count(*) n from c group by 1 order by 2 desc limit 10) t), '[]'),
    'browsers', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n)) from (select coalesce(browser,'Unknown') k, count(*) n from c group by 1 order by 2 desc limit 10) t), '[]'),
    'os', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n)) from (select coalesce(os,'Unknown') k, count(*) n from c group by 1 order by 2 desc limit 10) t), '[]'),
    'utm', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n)) from (select coalesce(utm_source,'(none)') || coalesce(' / ' || utm_medium,'') || coalesce(' / ' || utm_campaign,'') k, count(*) n from c group by 1 order by 2 desc limit 10) t), '[]'),
    'recent', coalesce((select jsonb_agg(r) from (select clicked_at, referrer_host, country, region, device, browser, os, utm_source, is_bot, rule_id from c order by clicked_at desc limit 25) r), '[]')
  ) into res;
  return res;
end $$;

create or replace function public.export_link_clicks(p_id uuid, p_owner text, p_from timestamptz, p_to timestamptz)
returns table (clicked_at timestamptz, referrer_host text, country text, region text, device text, browser text, os text, utm_source text, utm_medium text, utm_campaign text, is_bot boolean, rule_id text)
language sql stable security definer set search_path = public, extensions as $$
  select c.clicked_at, c.referrer_host, c.country, c.region, c.device, c.browser, c.os, c.utm_source, c.utm_medium, c.utm_campaign, c.is_bot, c.rule_id
  from link_clicks c join short_links s on s.id = c.link_id
  where c.link_id = p_id and s.owner_hash = public._sl_hash(p_owner) and c.clicked_at >= p_from and c.clicked_at < p_to
  order by c.clicked_at desc limit 10000
$$;

create or replace function public.create_monitor(p_owner text, p_url text, p_label text, p_interval int, p_webhook text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare new_id uuid;
begin
  if length(coalesce(p_owner, '')) < 32 then raise exception 'invalid owner token'; end if;
  if (select count(*) from monitors where owner_hash = public._sl_hash(p_owner)) >= 25 then raise exception 'Monitor limit reached (25).'; end if;
  insert into monitors (owner_hash, url, label, interval_minutes, webhook_url)
  values (public._sl_hash(p_owner), p_url, nullif(p_label,''), p_interval, nullif(p_webhook,'')) returning id into new_id;
  return new_id;
end $$;

create or replace function public.list_monitors(p_owner text)
returns table (id uuid, url text, label text, interval_minutes int, has_webhook boolean, enabled boolean, state text, last_checked_at timestamptz, next_check_at timestamptz, last_final_url text, last_status int, last_hops int, last_ms int, avg_ms int, last_error text, last_alert_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select id, url, label, interval_minutes, webhook_url is not null, enabled, state, last_checked_at, next_check_at, last_final_url, last_status, last_hops, last_ms, avg_ms, last_error, last_alert_at, created_at
  from monitors where owner_hash = public._sl_hash(p_owner) order by created_at desc limit 100
$$;

create or replace function public.owns_monitor(p_id uuid, p_owner text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists(select 1 from monitors where id = p_id and owner_hash = public._sl_hash(p_owner))
$$;

create or replace function public.update_monitor(p_id uuid, p_owner text, p_enabled boolean, p_interval int)
returns boolean language sql security definer set search_path = public, extensions as $$
  with u as (update monitors set enabled = coalesce(p_enabled, enabled), interval_minutes = coalesce(p_interval, interval_minutes)
    where id = p_id and owner_hash = public._sl_hash(p_owner) returning 1)
  select exists(select 1 from u)
$$;

create or replace function public.delete_monitor(p_id uuid, p_owner text)
returns boolean language sql security definer set search_path = public, extensions as $$
  with d as (delete from monitors where id = p_id and owner_hash = public._sl_hash(p_owner) returning 1)
  select exists(select 1 from d)
$$;

create or replace function public.monitor_history(p_id uuid, p_owner text)
returns setof public.monitor_checks language sql stable security definer set search_path = public, extensions as $$
  select c.* from monitor_checks c join monitors m on m.id = c.monitor_id
  where c.monitor_id = p_id and m.owner_hash = public._sl_hash(p_owner)
  order by c.checked_at desc limit 50
$$;

do $$ declare f text; begin
  foreach f in array array[
    'public.list_short_links(text)', 'public.get_redirect_target(text)',
    'public.record_link_click(uuid,text,text,text,text,text,text,text,text,text,text,boolean,text)',
    'public.set_short_link_rules(uuid,text,jsonb)', 'public.link_analytics(uuid,text,timestamptz,timestamptz)',
    'public.export_link_clicks(uuid,text,timestamptz,timestamptz)', 'public.create_monitor(text,text,text,int,text)',
    'public.list_monitors(text)', 'public.owns_monitor(uuid,text)', 'public.update_monitor(uuid,text,boolean,int)',
    'public.delete_monitor(uuid,text)', 'public.monitor_history(uuid,text)']
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;