'use client';

import type { people } from '@pos/api';
import { useTranslations } from 'next-intl';

/**
 * Label of a role in the user's UI language for the predefined roles; any other role shows the
 * name stored for the organization.
 */
export function useRoleLabel(roles: people.RoleDto[]) {
  const t = useTranslations('roles');
  return (key: string) => {
    if (t.has(`names.${key}`)) return t(`names.${key}`);
    return roles.find((role) => role.key === key)?.name ?? key;
  };
}
