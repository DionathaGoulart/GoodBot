/**
 * O painel vive em quatro hostnames que são o mesmo domínio com um rótulo na
 * frente (`invite.`, `demo.`, `admin.`), e os dois lados precisam chegar à
 * mesma string: o painel monta o `redirect_uri` do OAuth, e o bot monta o link
 * do convite que manda no servidor quando a demo acaba.
 *
 * A conta mora aqui, em `shared`, porque duas implementações da mesma regra é
 * como um `redirect_uri` deixa de bater com o Developer Portal.
 */
export function subdomainUrl(base: string, label: string | null, path = '/'): string {
  const url = new URL(base);
  if (label) url.hostname = `${label}.${url.hostname}`;
  return new URL(path, url.origin).toString();
}
