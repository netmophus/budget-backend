import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import {
  MODES_SAISIE_REALISE,
  type ModeSaisieRealise,
} from '../parametre-systeme.constants';

export class RealiseModeResponseDto {
  @ApiProperty({
    enum: MODES_SAISIE_REALISE as unknown as string[],
    description:
      'Mode de saisie du réalisé : CENTRALISE (import seul), DECENTRALISE (saisie CR), MIXTE.',
  })
  mode!: ModeSaisieRealise;
}

export class ModifierRealiseModeDto {
  @ApiProperty({ enum: MODES_SAISIE_REALISE as unknown as string[] })
  @IsIn(MODES_SAISIE_REALISE)
  mode!: ModeSaisieRealise;
}
