import { Module } from '@nestjs/common';
import { ClassifierService } from './classifier.service.js';

/**
 * ClassifierService 를 단일 공유 인스턴스로 제공한다.
 * (규칙 캐시가 인스턴스별이라, 여러 모듈이 각자 provider 로 선언하면 캐시가 분리되어
 *  키워드 변경 후 invalidate() 가 자동분류가 쓰는 캐시에 전파되지 않는다.)
 */
@Module({
  providers: [ClassifierService],
  exports: [ClassifierService],
})
export class ClassificationModule {}
