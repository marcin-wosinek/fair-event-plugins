import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/components';

const GroupsList = ({ groups, onEdit, onDelete }) => {
	if (!groups || groups.length === 0) {
		return (
			<p
				style={{
					textAlign: 'center',
					padding: '40px 0',
					color: '#757575',
				}}
			>
				{__(
					'No groups found. Create your first group to get started.',
					'fair-membership'
				)}
			</p>
		);
	}

	const formatAccessControl = (accessControl) => {
		const labels = {
			open: __('Open', 'fair-membership'),
			managed: __('Managed', 'fair-membership'),
		};
		return labels[accessControl] || accessControl;
	};

	const formatStatus = (status) => {
		return status === 'active'
			? __('Active', 'fair-membership')
			: __('Inactive', 'fair-membership');
	};

	const formatDate = (dateString) => {
		if (!dateString) return '-';
		const date = new Date(dateString);
		return date.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	};

	return (
		<table className="wp-list-table widefat fixed striped">
			<thead>
				<tr>
					<th scope="col" style={{ width: '20%' }}>
						{__('Name', 'fair-membership')}
					</th>
					<th scope="col" style={{ width: '15%' }}>
						{__('Slug', 'fair-membership')}
					</th>
					<th scope="col" style={{ width: '25%' }}>
						{__('Description', 'fair-membership')}
					</th>
					<th scope="col" style={{ width: '10%' }}>
						{__('Access', 'fair-membership')}
					</th>
					<th scope="col" style={{ width: '10%' }}>
						{__('Members', 'fair-membership')}
					</th>
					<th scope="col" style={{ width: '10%' }}>
						{__('Status', 'fair-membership')}
					</th>
					<th scope="col" style={{ width: '10%' }}>
						{__('Actions', 'fair-membership')}
					</th>
				</tr>
			</thead>
			<tbody>
				{groups.map((group) => (
					<tr key={group.id}>
						<td>
							<strong>{group.name}</strong>
						</td>
						<td>
							<code>{group.slug}</code>
						</td>
						<td>
							{group.description && group.description.length > 100
								? group.description.substring(0, 100) + '...'
								: group.description || (
										<span
											style={{
												color: '#757575',
												fontStyle: 'italic',
											}}
										>
											{__(
												'No description',
												'fair-membership'
											)}
										</span>
									)}
						</td>
						<td>{formatAccessControl(group.access_control)}</td>
						<td>
							<strong>{group.member_count || 0}</strong>
						</td>
						<td>
							<span
								className={`status-badge status-${group.status}`}
								style={{
									display: 'inline-block',
									padding: '2px 8px',
									borderRadius: '3px',
									fontSize: '12px',
									backgroundColor:
										group.status === 'active'
											? '#d4edda'
											: '#f8d7da',
									color:
										group.status === 'active'
											? '#155724'
											: '#721c24',
								}}
							>
								{formatStatus(group.status)}
							</span>
						</td>
						<td>
							<Button
								variant="secondary"
								isSmall
								onClick={() => onEdit(group)}
								style={{ marginRight: '5px' }}
							>
								{__('Edit', 'fair-membership')}
							</Button>
							<Button
								variant="tertiary"
								isDestructive
								isSmall
								onClick={() => onDelete(group)}
							>
								{__('Delete', 'fair-membership')}
							</Button>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
};

export default GroupsList;
