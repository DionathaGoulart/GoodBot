/** Um `FormData` com um campo só: o formato das ações de linha (apagar, match, arquivar). */
export function withId(key: string, value: string): FormData {
  const formData = new FormData();
  formData.set(key, value);
  return formData;
}

/** O corpo das ações de jogador: o objeto inteiro em JSON no campo `payload`. */
export function withPayload(payload: Record<string, unknown>): FormData {
  const formData = new FormData();
  formData.set('payload', JSON.stringify(payload));
  return formData;
}
