/**
 * Who sees which section (SPEC §14.5). Staff see everything and may write unless the owner
 * narrowed them in the People card; the `/admin` passcode session and the staff ids in
 * `INVENTORY_OWNERS` are owners; API tokens may read and write everything; the read token
 * reads everything; anyone else sees nothing.
 */
import type { Credential } from '@/lib/auth/credential';
import { getEnv } from '@/lib/env';
import { SLIP_KINDS, type InventorySettings, type SlipKind } from './model';

export interface Viewer {
  kind: 'anonymous' | 'staff' | 'token' | 'read_token' | 'admin';
  /** staff id or token label */
  id: string | null;
  name: string;
  owner: boolean;
  sections: SlipKind[];
  canWrite: boolean;
}

export function resolveViewer(cred: Credential | null, admin: boolean, settings: InventorySettings): Viewer {
  if (cred?.kind === 'staff') {
    const owner = admin || getEnv().INVENTORY_OWNERS.includes(cred.id);
    const rule = settings.access[cred.id];
    return {
      kind: 'staff',
      id: cred.id,
      name: cred.name,
      owner,
      sections: owner ? [...SLIP_KINDS] : rule ? [...rule.sections] : [...SLIP_KINDS],
      canWrite: owner ? true : rule ? rule.write : true,
    };
  }
  if (cred?.kind === 'token') return { kind: 'token', id: cred.label, name: cred.label, owner: false, sections: [...SLIP_KINDS], canWrite: true };
  if (cred?.kind === 'read_token') return { kind: 'read_token', id: null, name: 'read token', owner: false, sections: [...SLIP_KINDS], canWrite: false };
  if (admin) return { kind: 'admin', id: null, name: 'Admin', owner: true, sections: [...SLIP_KINDS], canWrite: true };
  return { kind: 'anonymous', id: null, name: '', owner: false, sections: [], canWrite: false };
}

export function canSee(viewer: Viewer, kind: SlipKind): boolean {
  return viewer.sections.includes(kind);
}

/** The `createdBy` recorded on a save. */
export function actorName(viewer: Viewer): string {
  return viewer.kind === 'token' ? `token:${viewer.name}` : viewer.name || 'Admin';
}
