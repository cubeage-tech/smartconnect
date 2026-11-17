import { Copy } from 'lucide-react';
import { toast } from 'react-toastify';
import { Button, Field, TextInput } from '../ui';

interface InvitationLinkNoticeProps {
  email: string;
  link: string;
  existingAccount: boolean;
}

/**
 * The invitation's own link, shown to the inviter right after inviting —
 * what they share when no e-mail goes out. It works only for the invited
 * address: a new person signs up with exactly that address; an existing
 * account signs in and accepts or declines (and also sees the invitation in
 * the app). Not stored or listed anywhere else.
 */
export const InvitationLinkNotice = ({ email, link, existingAccount }: InvitationLinkNoticeProps) => {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Invitation link copied.');
    } catch {
      toast.info('Select the link and copy it manually.');
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <Field
        label={`Invitation link for ${email}`}
        hint={
          existingAccount
            ? `${email} already has an account — they'll also see this invitation in SmartConnect. The link works only for that account.`
            : `Send it to them: it works only for ${email} and opens sign-up for that address.`
        }
      >
        <TextInput readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      </Field>
      <Button type="button" variant="secondary" size="sm" onClick={copy} icon={<Copy size={14} aria-hidden="true" />}>
        Copy invitation link
      </Button>
    </div>
  );
};
