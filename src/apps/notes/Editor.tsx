import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState,
  type Editor as TEditor, type JSONContent, type ReactNodeViewProps,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { clipboardFiles, fileUrl, isImage, normaliseUrl } from '../../platform/files';

// ---------- Images: stored privately, shown through short-lived links ----------
function ImageView({ node, selected }: ReactNodeViewProps) {
  const path = node.attrs.path as string | null;
  const [src, setSrc] = useState<string | null>(path ? null : (node.attrs.src as string | null));
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!path) return;
    let live = true;
    fileUrl(path).then(u => { if (live) { if (u) setSrc(u); else setBroken(true); } });
    return () => { live = false; };
  }, [path]);
  return (
    <NodeViewWrapper className={`note-img ${selected ? 'sel' : ''}`} data-drag-handle="">
      {src ? <img src={src} alt={(node.attrs.alt as string) ?? ''} draggable={false} />
        : <div className="img-loading">{broken ? "This image can't be shown." : 'Loading image…'}</div>}
    </NodeViewWrapper>
  );
}

const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      path: {
        default: null,
        parseHTML: el => el.getAttribute('data-path'),
        renderHTML: attrs => (attrs.path ? { 'data-path': attrs.path } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'img[data-path]' }, { tag: 'img[src]:not([src^="data:"]):not([src^="blob:"])' }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

const allowedHref = (url: string) => /^(https?:\/\/|mailto:)/i.test(url);

export interface EditorProps {
  content: JSONContent | null;
  editable: boolean;
  onChange: (doc: JSONContent) => void;
  /** upload an image into this page; resolves to its stored path */
  uploadImage: (f: File) => Promise<string | null>;
  /** other files pasted or dropped: attach them to the page */
  attachFiles: (f: File[]) => void;
}

export default function NoteEditor({ content, editable, onChange, uploadImage, attachFiles }: EditorProps) {
  const cb = useRef({ onChange, uploadImage, attachFiles });
  cb.current = { onChange, uploadImage, attachFiles };
  const ed = useRef<TEditor | null>(null);   // the handlers below are created once, so they read the editor from here

  const editor = useEditor({
    editable,
    content: content && Object.keys(content).length ? content : undefined,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          isAllowedUri: url => allowedHref(url),
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      NoteImage,
      Placeholder.configure({ placeholder: 'Start writing… Paste screenshots with Ctrl+V.' }),
    ],
    onUpdate: ({ editor: e }) => cb.current.onChange(e.getJSON()),
    editorProps: {
      attributes: { class: 'note-doc', 'aria-label': 'Page content' },
      handleClick(view, _pos, event) {
        const a = (event.target as HTMLElement).closest('a');
        if (!a) return false;
        if (!view.editable || event.ctrlKey || event.metaKey) {
          if (allowedHref(a.href)) window.open(a.href, '_blank', 'noopener');
          return true;
        }
        return false;
      },
      handlePaste(view, event) {
        if (!view.editable) return false;
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (text.trim()) return false;          // text, cells from Excel etc. paste normally
        const files = clipboardFiles(event);
        if (!files.length) return false;
        event.preventDefault();
        void addFiles(files, null);
        return true;
      },
      handleDrop(view, event, _slice, moved) {
        if (!view.editable || moved || !event.dataTransfer?.files.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
        void addFiles(Array.from(event.dataTransfer.files), at);
        return true;
      },
    },
  });

  async function addFiles(files: File[], at: number | null) {
    const imgs = files.filter(f => isImage(f.type, f.name));
    const others = files.filter(f => !isImage(f.type, f.name));
    if (others.length) cb.current.attachFiles(others);
    for (const f of imgs) {
      const path = await cb.current.uploadImage(f);
      const e = ed.current;
      if (!path || !e || e.isDestroyed) continue;
      // an empty line after the image keeps the cursor out of it, so typing never replaces the picture
      const nodes = [{ type: 'image', attrs: { path, alt: f.name } }, { type: 'paragraph' }];
      if (at !== null) e.chain().focus().insertContentAt(Math.min(at, e.state.doc.content.size), nodes).run();
      else e.chain().focus().insertContent(nodes).run();
    }
  }

  ed.current = editor;
  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);

  if (!editor) return null;
  return (
    <div className={`note-editor ${editable ? 'editable' : 'readonly'}`}>
      {editable && <Toolbar editor={editor} onImage={files => addFiles(files, null)} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor, onImage }: { editor: TEditor; onImage: (f: File[]) => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      p: e.isActive('paragraph'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      link: e.isActive('link'),
      href: (e.getAttributes('link').href as string | undefined) ?? '',
      table: e.isActive('table'),
      undo: e.can().undo(),
      redo: e.can().redo(),
    }),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const imgInput = useRef<HTMLInputElement>(null);
  const c = () => editor.chain().focus();

  function openLink() {
    setUrl(s.href);
    setLinkOpen(o => !o);
  }
  function applyLink(e: FormEvent) {
    e.preventDefault();
    const href = normaliseUrl(url);
    if (!url.trim()) c().extendMarkRange('link').unsetLink().run();
    else if (!href) return;
    else if (editor.state.selection.empty && !s.link) {
      c().insertContent({ type: 'text', text: url.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
    } else c().extendMarkRange('link').setLink({ href }).run();
    setLinkOpen(false);
  }

  const B = ({ on, label, title, run, disabled }: { on?: boolean; label: string; title: string; run: () => void; disabled?: boolean }) => (
    <button type="button" className={`tb ${on ? 'on' : ''}`} title={title} aria-label={title} aria-pressed={on}
      disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={run}>{label}</button>
  );

  return (
    <div className="note-toolbar-wrap">
      <div className="note-toolbar" role="toolbar" aria-label="Formatting">
        <B on={s.p && !s.bullet && !s.ordered && !s.task} label="Text" title="Normal text" run={() => c().setParagraph().run()} />
        <B on={s.h1} label="H1" title="Big heading" run={() => c().toggleHeading({ level: 1 }).run()} />
        <B on={s.h2} label="H2" title="Medium heading" run={() => c().toggleHeading({ level: 2 }).run()} />
        <B on={s.h3} label="H3" title="Small heading" run={() => c().toggleHeading({ level: 3 }).run()} />
        <span className="tb-sep" />
        <B on={s.bold} label="B" title="Bold (Ctrl+B)" run={() => c().toggleBold().run()} />
        <B on={s.italic} label="I" title="Italic (Ctrl+I)" run={() => c().toggleItalic().run()} />
        <B on={s.strike} label="S" title="Strikethrough" run={() => c().toggleStrike().run()} />
        <span className="tb-sep" />
        <B on={s.bullet} label="• List" title="Bullet list" run={() => c().toggleBulletList().run()} />
        <B on={s.ordered} label="1. List" title="Numbered list" run={() => c().toggleOrderedList().run()} />
        <B on={s.task} label="☑ Tickbox" title="Tickbox list" run={() => c().toggleTaskList().run()} />
        <span className="tb-sep" />
        <B on={s.link || linkOpen} label="Link" title="Add or edit a link" run={openLink} />
        <B on={s.table} label="Table" title="Insert a table" run={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} disabled={s.table} />
        <B label="Image" title="Add an image" run={() => imgInput.current?.click()} />
        <B label="―" title="Divider line" run={() => c().setHorizontalRule().run()} />
        <span className="tb-sep" />
        <B label="↶" title="Undo (Ctrl+Z)" run={() => c().undo().run()} disabled={!s.undo} />
        <B label="↷" title="Redo (Ctrl+Y)" run={() => c().redo().run()} disabled={!s.redo} />
        <input ref={imgInput} type="file" accept="image/*" multiple hidden
          onChange={e => { onImage(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      </div>
      {s.table && (
        <div className="note-toolbar sub" role="toolbar" aria-label="Table">
          <span className="muted tiny">Table:</span>
          <B label="+ Row" title="Add a row below" run={() => c().addRowAfter().run()} />
          <B label="+ Column" title="Add a column to the right" run={() => c().addColumnAfter().run()} />
          <B label="− Row" title="Delete this row" run={() => c().deleteRow().run()} />
          <B label="− Column" title="Delete this column" run={() => c().deleteColumn().run()} />
          <B label="Delete table" title="Delete the whole table" run={() => c().deleteTable().run()} />
        </div>
      )}
      {linkOpen && (
        <form className="link-form note-link" onSubmit={applyLink}>
          <input autoFocus type="text" placeholder="https://… (leave empty to remove the link)" value={url}
            onChange={e => setUrl(e.target.value)} aria-label="Link address"
            onKeyDown={e => { if (e.key === 'Escape') setLinkOpen(false); }} />
          <button className="btn primary sm">{url.trim() ? 'Apply' : 'Remove link'}</button>
          <button type="button" className="btn sm" onClick={() => setLinkOpen(false)}>Cancel</button>
        </form>
      )}
    </div>
  );
}
