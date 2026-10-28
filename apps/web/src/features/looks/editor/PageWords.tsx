/**
 * "Edit this page's words": the wording slots of the page being read, in a
 * box over it, each the same editor as Settings › Wording (SlotEditor). A
 * save refreshes what the page reads, so the words change behind the box.
 *
 * Loaded only when an administrator opens it (EditDock.tsx imports it
 * lazily), so nobody else downloads the settings code.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Btn } from '@/mockup/Btn.tsx';
import { Modal } from '@/mockup/Modal.tsx';
import { Note } from '@/mockup/Note.tsx';
import { editorQuery } from '../../../routes/(staff)/settings/-editor.tsx';
import { SlotEditor } from '../../../routes/(staff)/settings/words.tsx';
import { SettingsFrame } from '../../settings/panels.tsx';

export default function PageWords({
  slots,
  onClose,
}: {
  slots: readonly string[];
  onClose: () => void;
}) {
  const editor = useQuery(editorQuery);
  const here = (editor.data?.copy ?? []).filter((s) => slots.includes(s.key));
  return (
    <Modal
      open
      title="The words on this page"
      description="Each applies as soon as it is saved. The rest of this page’s text is part of the software."
      onClose={onClose}
      buttons={
        <>
          <Link to="/settings/words" className="btn sm flat ghost" onClick={onClose}>
            All the wording
          </Link>
          <Btn sm flat look="ink" onClick={onClose}>
            Done
          </Btn>
        </>
      }
    >
      {editor.isPending ? <p role="status">Loading the words…</p> : null}
      {editor.isError ? (
        <Note tone="serious" title="The words could not be opened.">
          {editor.error.message}
        </Note>
      ) : null}
      {editor.data && here.length === 0 ? (
        <p className="m">Nothing on this page can be reworded here.</p>
      ) : null}
      {here.length > 0 ? (
        <div className="col" style={{ gap: 12, maxHeight: '70vh', overflowY: 'auto' }}>
          <SettingsFrame>
            {here.map((slot) => (
              <SlotEditor key={slot.key} slot={slot} />
            ))}
          </SettingsFrame>
        </div>
      ) : null}
    </Modal>
  );
}
