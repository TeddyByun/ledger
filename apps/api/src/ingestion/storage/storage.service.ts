import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * 파일 저장 추상화. 초기엔 로컬 디스크, 이후 S3 어댑터로 교체 가능.
 * 업로드 원본은 감사·재처리를 위해 보관한다(ARCHITECTURE §9).
 */
@Injectable()
export class StorageService {
  private readonly root = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

  /** 버퍼를 저장하고 접근 키(상대 경로)를 반환. */
  async save(key: string, data: Buffer): Promise<string> {
    const full = join(this.root, key);
    await fs.mkdir(dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return key;
  }

  async load(key: string): Promise<Buffer> {
    return fs.readFile(join(this.root, key));
  }
}
