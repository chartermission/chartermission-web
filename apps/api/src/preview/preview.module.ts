import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { PreviewController } from './preview.controller.js';
import { PreviewService } from './preview.service.js';

@Module({
  imports: [MediaModule],
  controllers: [PreviewController],
  providers: [PreviewService],
  exports: [PreviewService],
})
export class PreviewModule {}
