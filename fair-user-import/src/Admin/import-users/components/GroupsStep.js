/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * Groups Step Component - Select groups to assign to imported users
 *
 * @param {Object} props Component props
 * @param {Array} props.initialGroups Initial selected group IDs
 * @param {Function} props.onComplete Callback when groups are selected
 * @param {Function} props.onBack Callback to go back
 * @return {JSX.Element} The Groups Step component
 */
export default function GroupsStep({ initialGroups, onComplete, onBack }) {
	const [groups, setGroups] = useState([]);
	const [selectedGroups, setSelectedGroups] = useState(initialGroups || []);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);

	// Load groups on mount
	useEffect(() => {
		apiFetch({ path: '/fair-membership/v1/groups' })
			.then((data) => {
				setGroups(data);
				setIsLoading(false);
			})
			.catch((err) => {
				setError(err.message);
				setIsLoading(false);
			});
	}, []);

	const handleGroupToggle = (groupId) => {
		setSelectedGroups((prev) => {
			if (prev.includes(groupId)) {
				return prev.filter((id) => id !== groupId);
			}
			return [...prev, groupId];
		});
	};

	const handleSelectAll = () => {
		setSelectedGroups(groups.map((group) => group.id));
	};

	const handleDeselectAll = () => {
		setSelectedGroups([]);
	};

	const handleContinue = () => {
		onComplete(selectedGroups);
	};

	if (isLoading) {
		return (
			<div className="fair-membership-groups-step">
				<p>{__('Loading groups...', 'fair-user-import')}</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="fair-membership-groups-step">
				<div className="notice notice-error">
					<p>
						{__('Error loading groups: ', 'fair-user-import')}
						{error}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="fair-membership-groups-step">
			<p>
				{__(
					"Select which Fair Membership groups to assign to the imported users. You can skip this step if you don't want to assign any groups.",
					'fair-user-import'
				)}
			</p>

			{groups.length === 0 ? (
				<div className="notice notice-warning">
					<p>
						{__(
							'No groups available. You can create groups in the Groups page.',
							'fair-user-import'
						)}
					</p>
				</div>
			) : (
				<>
					<div className="fair-membership-groups-controls">
						<button
							type="button"
							className="button"
							onClick={handleSelectAll}
							disabled={selectedGroups.length === groups.length}
						>
							{__('Select All', 'fair-user-import')}
						</button>
						<button
							type="button"
							className="button"
							onClick={handleDeselectAll}
							disabled={selectedGroups.length === 0}
							style={{ marginLeft: '10px' }}
						>
							{__('Deselect All', 'fair-user-import')}
						</button>
					</div>

					<div className="fair-membership-groups-list">
						{groups.map((group) => (
							<label
								key={group.id}
								className="fair-membership-group-item"
							>
								<input
									type="checkbox"
									checked={selectedGroups.includes(group.id)}
									onChange={() => handleGroupToggle(group.id)}
								/>
								<span className="group-name">{group.name}</span>
								{group.description && (
									<span className="group-description">
										{group.description}
									</span>
								)}
							</label>
						))}
					</div>

					<div className="fair-membership-groups-summary">
						<p>
							<strong>
								{__('Selected groups:', 'fair-user-import')}
							</strong>{' '}
							{selectedGroups.length > 0 ? (
								<>
									{selectedGroups.length}{' '}
									{__(
										selectedGroups.length === 1
											? 'group'
											: 'groups',
										'fair-user-import'
									)}
								</>
							) : (
								__(
									'None (users will be created without group assignments)',
									'fair-user-import'
								)
							)}
						</p>
					</div>
				</>
			)}

			<div className="fair-membership-groups-actions">
				<button
					type="button"
					className="button"
					onClick={onBack}
					style={{ marginRight: '10px' }}
				>
					{__('← Back to Preview', 'fair-user-import')}
				</button>
				<button
					type="button"
					className="button button-primary"
					onClick={handleContinue}
				>
					{__('Continue to Confirmation', 'fair-user-import')}
				</button>
			</div>

			<style>{`
				.fair-membership-groups-step {
					margin-top: 20px;
				}
				.fair-membership-groups-controls {
					margin: 20px 0;
				}
				.fair-membership-groups-list {
					border: 1px solid #ddd;
					border-radius: 4px;
					padding: 15px;
					max-height: 400px;
					overflow-y: auto;
					background: #fff;
				}
				.fair-membership-group-item {
					display: block;
					padding: 10px;
					margin-bottom: 5px;
					border-bottom: 1px solid #f0f0f0;
					cursor: pointer;
				}
				.fair-membership-group-item:last-child {
					border-bottom: none;
				}
				.fair-membership-group-item:hover {
					background: #f9f9f9;
				}
				.fair-membership-group-item input[type="checkbox"] {
					margin-right: 10px;
				}
				.fair-membership-group-item .group-name {
					font-weight: 600;
				}
				.fair-membership-group-item .group-description {
					display: block;
					margin-left: 28px;
					margin-top: 5px;
					color: #666;
					font-size: 0.9em;
				}
				.fair-membership-groups-summary {
					margin: 20px 0;
					padding: 15px;
					background: #f0f6fc;
					border-left: 4px solid #2271b1;
				}
				.fair-membership-groups-summary p {
					margin: 0;
				}
				.fair-membership-groups-actions {
					margin-top: 20px;
				}
			`}</style>
		</div>
	);
}
