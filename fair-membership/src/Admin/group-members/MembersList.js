import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/components';

const MembersList = ({ members, onRemove }) => {
	if (!members || members.length === 0) {
		return (
			<p className="description">
				{__('No members in this group yet.', 'fair-membership')}
			</p>
		);
	}

	return (
		<table className="wp-list-table widefat fixed striped">
			<thead>
				<tr>
					<th style={{ width: '30%' }}>
						{__('Name', 'fair-membership')}
					</th>
					<th style={{ width: '25%' }}>
						{__('Email', 'fair-membership')}
					</th>
					<th style={{ width: '20%' }}>
						{__('Username', 'fair-membership')}
					</th>
					<th style={{ width: '15%' }}>
						{__('Joined', 'fair-membership')}
					</th>
					<th style={{ width: '10%' }}>
						{__('Actions', 'fair-membership')}
					</th>
				</tr>
			</thead>
			<tbody>
				{members.map((member) => (
					<tr key={member.id}>
						<td>
							<strong>{member.name}</strong>
						</td>
						<td>{member.email}</td>
						<td>{member.login}</td>
						<td>
							{new Date(member.started_at).toLocaleDateString()}
						</td>
						<td>
							<Button
								variant="link"
								isDestructive
								onClick={() => onRemove(member)}
								style={{ padding: 0 }}
							>
								{__('Remove', 'fair-membership')}
							</Button>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
};

export default MembersList;
