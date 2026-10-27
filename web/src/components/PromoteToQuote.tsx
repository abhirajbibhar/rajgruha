/**
 * "Add to quotes" for an annotation.
 *
 * The text is pre-filled from the highlight (or the note when the highlight has
 * no captured text) and stays editable, because a quote is usually a trimmed
 * version of what was highlighted. Promoting the same annotation twice updates
 * the existing quote instead of creating a duplicate.
 */
import { useState } from 'react';
import { api } from '../api';
import { Banner, Field, FormModal, useToast } from './ui';
import { formatDate } from '../lib/format';
import type { AnnotationIndexItem, Quote } from '../../../shared/types';

interface Props {
  item: AnnotationIndexItem;
  onClose: () => void;
  onPromoted?: (quote: Quote, created: boolean) => void;
}

export function PromoteToQuote({ item, onClose, onPromoted }: Props) {
  const toast = useToast();
  const [text, setText] = useState(item.text ?? item.note ?? '');
  const [note, setNote] = useState(item.text && item.note ? item.note : '');
  const [author, setAuthor] = useState('');
  const [tags, setTags] = useState(item.kind === 'highlight' ? '' : item.kind);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!text.trim()) {
      setError('A quote needs some text.');
      return;
    }
    try {
      const result = await api.promoteAnnotation({
        bookId: item.bookId,
        annotationId: item.id,
        text: text.trim(),
        note: note.trim() || undefined,
        author: author.trim() || undefined,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      toast.push(result.created ? 'Added to your quotes' : 'Quote updated', 'success');
      onPromoted?.(result.quote, result.created);
      onClose();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'Could not add that quote.');
    }
  }

  return (
    <FormModal title="Add to quotes" onClose={onClose} onSubmit={submit} submitLabel="Save quote">
      {error && <Banner kind="error">{error}</Banner>}

      <Banner kind="info">
        From <strong>{item.bookTitle}</strong>, page {item.page + 1}
        {item.updatedAt ? ` · ${formatDate(item.updatedAt)}` : ''}
      </Banner>

      <Field label="Quote text" hint="edit it down to the part worth keeping">
        <textarea
          className="textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          style={{ fontFamily: 'var(--font-serif)', minHeight: 120 }}
          maxLength={4000}
          autoFocus
        />
      </Field>

      <Field label="Your note" hint="optional">
        <textarea
          className="textarea"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          style={{ fontFamily: 'var(--font-ui)', minHeight: 70 }}
          maxLength={4000}
        />
      </Field>

      <Field label="Attribute to" hint="optional">
        <input
          className="input"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          placeholder={item.author ?? ''}
          maxLength={160}
        />
      </Field>

      <Field label="Tags" hint="comma separated">
        <input className="input" value={tags} onChange={(event) => setTags(event.target.value)} />
      </Field>
    </FormModal>
  );
}
