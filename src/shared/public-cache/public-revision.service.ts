import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';

export interface PublicRevision {
  revision: string;
  epoch: string;
  sequence: string;
  enabled: boolean;
}

@Injectable()
export class PublicRevisionService {
  constructor(private readonly db: DataSource) {}

  get enabled(): boolean {
    return process.env['PUBLIC_CONTENT_CACHE_ENABLED'] === 'true';
  }

  async read(): Promise<PublicRevision> {
    const [row] = await this.db.query<Array<{ epoch: string; sequence: string }>>(
      `SELECT epoch::text,(SELECT count(*) FROM moc_cache.public_changes)::text AS sequence
       FROM moc_cache.public_revision WHERE singleton=true`,
    );
    if (!row) throw new Error('Public content revision is unavailable');
    return {
      revision: createHash('sha256')
        .update(row.epoch + ':' + row.sequence)
        .digest('hex')
        .slice(0, 24),
      epoch: row.epoch,
      sequence: row.sequence,
      enabled: this.enabled,
    };
  }
}
