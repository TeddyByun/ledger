/** 적재 큐 이름 및 잡 페이로드 타입 (공용). */
export const IMPORT_QUEUE = 'import';

export interface ImportJobPayload {
  jobId: string;
}
