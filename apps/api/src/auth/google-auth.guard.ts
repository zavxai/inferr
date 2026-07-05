import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Custom Google AuthGuard extending standard passport Google strategy.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {}
