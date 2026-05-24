/**
 * DocumentsOfficielsModule (Lot 8.1.A) — fondation DB du workflow
 * signature MIZNAS.
 *
 * Au Palier 1, ce module n'expose AUCUN service / controller — il
 * enregistre uniquement les 5 entités TypeORM auprès de la connexion
 * pour permettre leur injection dans les futurs services (Lot 8.1.B :
 * service workflow, Lot 8.1.C : controller + endpoints).
 *
 * 5 entités enregistrées :
 *  - CampagneBudgetaire (1 ligne par exercice fiscal)
 *  - CampagneComiteMembre (N membres comité par campagne)
 *  - DocumentOfficiel (1 ligne par document : lettre, note, PV, ...)
 *  - DocumentVisa (snapshot du comité au moment de la soumission)
 *  - DocumentSignature (empreinte crypto finale, 1 par document)
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { User } from '../users/entities/user.entity';
import { CampagneBudgetaire } from './entities/campagne-budgetaire.entity';
import { CampagneComiteMembre } from './entities/campagne-comite-membre.entity';
import { DocumentOfficiel } from './entities/document-officiel.entity';
import { DocumentSignature } from './entities/document-signature.entity';
import { DocumentVisa } from './entities/document-visa.entity';
import { LettreCadrageDetail } from './entities/lettre-cadrage-detail.entity';
import { CampagnesController } from './controllers/campagnes.controller';
import { DocumentsController } from './controllers/documents.controller';
import { CampagneService } from './services/campagne.service';
import { DocumentFichierService } from './services/document-fichier.service';
import { DocumentHashService } from './services/document-hash.service';
import { DocumentWorkflowService } from './services/document-workflow.service';
import { LettreCadrageService } from './services/lettre-cadrage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CampagneBudgetaire,
      CampagneComiteMembre,
      DocumentOfficiel,
      DocumentVisa,
      DocumentSignature,
      LettreCadrageDetail, // Lot 8.2.C — détail métier D2_LETTRE_CADRAGE
      User, // pour lookup signataire dans CampagneService + bcrypt dans DocumentWorkflowService
    ]),
    AuditModule, // pour AuditService dans CampagneService
  ],
  controllers: [CampagnesController, DocumentsController],
  providers: [
    DocumentHashService,
    CampagneService,
    DocumentWorkflowService,
    DocumentFichierService,
    LettreCadrageService,
  ],
  exports: [
    TypeOrmModule,
    DocumentHashService,
    CampagneService,
    DocumentWorkflowService,
    DocumentFichierService,
    LettreCadrageService,
  ],
})
export class DocumentsOfficielsModule {}
