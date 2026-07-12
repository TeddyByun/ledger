import { Injectable, BadRequestException } from '@nestjs/common';
import { Issuer } from '@ledger/shared';
import { GenericBankParser } from './bank.parser.js';
import { GenericCardParser } from './card.parser.js';
import type { StatementParser } from './types.js';

/**
 * 발급사 → 파서 어댑터 매핑. 카드사는 컬럼 별칭이 대부분 겹쳐
 * 하나의 GenericCardParser 를 재사용하고, 은행은 GenericBankParser 를 쓴다.
 * 특정 발급사가 특이 포맷이면 여기서 전용 파서로 교체만 하면 된다.
 */
@Injectable()
export class ParserRegistry {
  private readonly parsers = new Map<Issuer, StatementParser>([
    [Issuer.HANA_BANK, new GenericBankParser(Issuer.HANA_BANK)],
    [Issuer.HANA_CARD, new GenericCardParser(Issuer.HANA_CARD)],
    [Issuer.HYUNDAI_CARD, new GenericCardParser(Issuer.HYUNDAI_CARD)],
    [Issuer.SHINHAN_CARD, new GenericCardParser(Issuer.SHINHAN_CARD)],
    [Issuer.SAMSUNG_CARD, new GenericCardParser(Issuer.SAMSUNG_CARD)],
  ]);

  get(issuer: Issuer): StatementParser {
    const parser = this.parsers.get(issuer);
    if (!parser) throw new BadRequestException(`unsupported issuer: ${issuer}`);
    return parser;
  }
}
