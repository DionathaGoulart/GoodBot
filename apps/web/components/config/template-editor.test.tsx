// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TemplateEditor, type TemplatePreviewMode } from './template-editor';

import type { MessageTemplate } from '@goodbot/shared';

const TEMPLATE: MessageTemplate = { content: '{author} {headline}' };

/** Os três tipos da tela de redes sociais, reduzidos ao que o preview usa. */
const MODES: TemplatePreviewMode[] = [
  { id: 'video', label: 'VÍDEO', vars: { headline: 'publicou um vídeo novo' } },
  { id: 'short', label: 'SHORT', vars: { headline: 'publicou um short' } },
  { id: 'live', label: 'LIVE', vars: { headline: 'está ao vivo' } },
];

describe('TemplateEditor', () => {
  it('oferece só as variáveis que a tela sabe preencher', () => {
    render(
      <TemplateEditor
        value={TEMPLATE}
        embedColor={0xdc143c}
        variables={['title', 'headline']}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '{headline}' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '{memberCount}' })).toBeNull();
  });

  it('troca o preview entre os tipos sem tocar no template', () => {
    const onChange = vi.fn();
    render(
      <TemplateEditor
        value={TEMPLATE}
        embedColor={0xdc143c}
        previewModes={MODES}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('Canal de exemplo publicou um vídeo novo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'LIVE' }));

    expect(screen.getByText('Canal de exemplo está ao vivo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'LIVE' })).toHaveAttribute('aria-pressed', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('sem modos, o preview não mostra barra de troca', () => {
    render(<TemplateEditor value={TEMPLATE} embedColor={0xdc143c} onChange={vi.fn()} />);
    expect(screen.queryByRole('group', { name: 'Tipo do preview' })).toBeNull();
  });
});
