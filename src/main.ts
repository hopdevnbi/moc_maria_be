import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApplication } from './bootstrap/configure-application';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create(AppModule, { bufferLogs: true });
  application.useLogger(application.get(Logger));
  configureApplication(application);

  const config = application.get(AppConfigService);
  await application.listen(config.getPort(), '0.0.0.0');

  application.get(Logger).log('Moc Maria API listening on port ' + config.getPort());
}

void bootstrap();
