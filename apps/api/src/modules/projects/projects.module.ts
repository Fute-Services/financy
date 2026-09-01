import { Module } from '@nestjs/common';

import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

/**
 * Projects and categories — the two dimensions spend is coded to.
 *
 * One module, two controllers, and deliberately not two modules: they are
 * edited from the same settings screen, share the same archive semantics, and
 * splitting them would buy two files and no separation. Their *permissions*
 * differ, and that difference lives on the routes, where it is enforced.
 */
@Module({
  controllers: [ProjectsController, CategoriesController],
  providers: [ProjectsService, CategoriesService],
  exports: [ProjectsService, CategoriesService],
})
export class ProjectsModule {}
