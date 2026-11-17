import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import {
  ExamInstructorInput,
  ExamInstructorsQuery,
  UpdateExamInstructorInput,
  type ExamInstructor,
  type ExamInstructorList,
  type ExamInstructorSaved,
  type Ok,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { AdminExamInstructorsService } from './admin-exam-instructors.service.js';

/** Instructors who sign Charter Center certificates, shared by exams (admin console, Exams → Instructors). */
@Controller('admin/exam-instructors')
export class AdminExamInstructorsController {
  constructor(private readonly instructors: AdminExamInstructorsService) {}

  @Get()
  @Access('admin', 'exam.manage')
  list(@ZQuery(ExamInstructorsQuery) q: ExamInstructorsQuery): Promise<ExamInstructorList> {
    return this.instructors.list(q);
  }

  @Post()
  @HttpCode(201)
  @Access('admin', 'exam.manage')
  create(@Auth() ctx: AuthContext, @ZBody(ExamInstructorInput) input: ExamInstructorInput, @Req() req: AppRequest): Promise<ExamInstructor> {
    return this.instructors.create(ctx, input, clientIp(req));
  }

  @Patch(':id')
  @Access('admin', 'exam.manage')
  update(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(UpdateExamInstructorInput) input: UpdateExamInstructorInput,
    @Req() req: AppRequest,
  ): Promise<ExamInstructorSaved> {
    return this.instructors.update(ctx, id, input, clientIp(req));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Access('admin', 'exam.manage')
  archive(@Auth() ctx: AuthContext, @Param('id') id: string, @Req() req: AppRequest): Promise<ExamInstructor> {
    return this.instructors.archive(ctx, id, clientIp(req));
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Access('admin', 'exam.manage')
  restore(@Auth() ctx: AuthContext, @Param('id') id: string, @Req() req: AppRequest): Promise<ExamInstructor> {
    return this.instructors.restore(ctx, id, clientIp(req));
  }

  @Delete(':id')
  @Access('admin', 'exam.manage')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string, @Req() req: AppRequest): Promise<Ok> {
    return this.instructors.remove(ctx, id, clientIp(req));
  }
}
