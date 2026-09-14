/** Um `FormData` com um campo só: o formato das ações de linha (apagar, match, arquivar). */
export function withId(key: string, value: string): FormData {
  const formData = new FormData();
  formData.set(key, value);
  return formData;
}
