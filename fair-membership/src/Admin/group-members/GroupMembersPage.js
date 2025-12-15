import { useState, useEffect } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import MembersList from './MembersList.js';
import UserSearch from './UserSearch.js';
import SendEmailModal from './SendEmailModal.js';

const GroupMembersPage = ({ groupId }) => {
	const [group, setGroup] = useState(null);
	const [members, setMembers] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);

	// Load group and members
	useEffect(() => {
		loadGroupMembers();
	}, [groupId]);

	const loadGroupMembers = async () => {
		setLoading(true);
		setError(null);

		try {
			const response = await apiFetch({
				path: `/fair-membership/v1/groups/${groupId}/members`,
			});

			setGroup(response.group);
			setMembers(response.members || []);
		} catch (err) {
			const errorMessage =
				err.message ||
				__('Failed to load group members.', 'fair-membership');
			setError(errorMessage);
		} finally {
			setLoading(false);
		}
	};

	const handleAddMember = async (userId) => {
		try {
			const response = await apiFetch({
				path: `/fair-membership/v1/groups/${groupId}/members`,
				method: 'POST',
				data: { user_id: userId },
			});

			// Add new member to list
			setMembers((prev) => [...prev, response.member]);
			setSuccess(__('Member added successfully.', 'fair-membership'));
			setError(null);
		} catch (err) {
			throw new Error(
				err.message || __('Failed to add member.', 'fair-membership')
			);
		}
	};

	const handleRemoveMember = async (member) => {
		if (
			!confirm(
				sprintf(
					__(
						'Are you sure you want to remove %s from this group?',
						'fair-membership'
					),
					member.name
				)
			)
		) {
			return;
		}

		try {
			await apiFetch({
				path: `/fair-membership/v1/groups/${groupId}/members/${member.id}`,
				method: 'DELETE',
			});

			// Remove from local state
			setMembers((prev) => prev.filter((m) => m.id !== member.id));
			setSuccess(__('Member removed successfully.', 'fair-membership'));
			setError(null);
		} catch (err) {
			setError(
				err.message || __('Failed to remove member.', 'fair-membership')
			);
			setSuccess(null);
		}
	};

	const handleSendEmail = async (emailData) => {
		try {
			const response = await apiFetch({
				path: `/fair-membership/v1/groups/${groupId}/send-email`,
				method: 'POST',
				data: emailData,
			});

			setSuccess(response.message);
			setError(null);
			setIsEmailModalOpen(false);
		} catch (err) {
			throw new Error(
				err.message || __('Failed to send email.', 'fair-membership')
			);
		}
	};

	if (loading) {
		return (
			<div className="wrap">
				<h1>{__('Group Members', 'fair-membership')}</h1>
				<Spinner />
			</div>
		);
	}

	if (!group) {
		return (
			<div className="wrap">
				<h1>{__('Group Not Found', 'fair-membership')}</h1>
				<p>
					{__(
						'The requested group could not be found.',
						'fair-membership'
					)}
				</p>
				<a href="admin.php?page=fair-membership" className="button">
					{__('Back to Groups', 'fair-membership')}
				</a>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1 className="wp-heading-inline">
				{sprintf(__('Members of %s', 'fair-membership'), group.name)}
			</h1>
			<a
				href="admin.php?page=fair-membership"
				className="page-title-action"
				style={{ marginLeft: '10px' }}
			>
				{__('← Back to Groups', 'fair-membership')}
			</a>
			<hr className="wp-header-end" />

			{error && (
				<Notice
					status="error"
					isDismissible
					onRemove={() => setError(null)}
				>
					{error}
				</Notice>
			)}

			{success && (
				<Notice
					status="success"
					isDismissible
					onRemove={() => setSuccess(null)}
				>
					{success}
				</Notice>
			)}

			<Card style={{ marginBottom: '20px' }}>
				<CardHeader>
					<HStack>
						<h2>{__('Add Members', 'fair-membership')}</h2>
					</HStack>
				</CardHeader>
				<CardBody>
					<UserSearch
						onAddMember={handleAddMember}
						existingMemberIds={members.map((m) => m.id)}
					/>
				</CardBody>
			</Card>

			<Card>
				<CardHeader>
					<HStack>
						<h2>{__('Current Members', 'fair-membership')}</h2>
						<span style={{ marginLeft: 'auto', color: '#757575' }}>
							{sprintf(
								__('%d members', 'fair-membership'),
								members.length
							)}
						</span>
						<Button
							variant="secondary"
							onClick={() => setIsEmailModalOpen(true)}
							disabled={members.length === 0}
						>
							{__('Send Message to Members', 'fair-membership')}
						</Button>
					</HStack>
				</CardHeader>
				<CardBody>
					<MembersList
						members={members}
						onRemove={handleRemoveMember}
					/>
				</CardBody>
			</Card>

			{isEmailModalOpen && (
				<SendEmailModal
					groupName={group.name}
					memberCount={members.length}
					onSend={handleSendEmail}
					onClose={() => setIsEmailModalOpen(false)}
				/>
			)}
		</div>
	);
};

export default GroupMembersPage;
