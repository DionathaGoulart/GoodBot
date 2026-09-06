'use server';

import { signIn, signOut } from '@/auth';

export async function signInWithDiscord(): Promise<void> {
  await signIn('discord', { redirectTo: '/' });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
