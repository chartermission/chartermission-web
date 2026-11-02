import { Test, TestingModule } from '@nestjs/testing';
import { HealthResponse } from '@chartermission/contracts';
import { AppController } from './app.controller.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('reports health in the shared contract shape', () => {
    expect(HealthResponse.parse(appController.health()).status).toBe('ok');
  });
});
