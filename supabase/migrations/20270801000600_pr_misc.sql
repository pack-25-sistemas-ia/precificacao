-- Precificação Inteligente — apoio (parte 7): nomes dos membros para «responsável» nas telas.

begin;
set local check_function_bodies = off;

-- Qualquer membro vê os colegas da própria empresa, só nome de exibição e papel.
create function public.pr_member_names(p_org uuid) returns table (user_id uuid, display_name text, role public.org_role)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.pr_guard(p_org, 'read');
  return query select m.user_id, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1), 'usuário'), m.role
               from public.organization_members m left join public.profiles p on p.id = m.user_id where m.organization_id = p_org;
end $$;
revoke all on function public.pr_member_names(uuid) from public, anon;
grant execute on function public.pr_member_names(uuid) to authenticated;

commit;
