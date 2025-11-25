import { __ } from '@wordpress/i18n';
import { Button, SelectControl, Notice } from '@wordpress/components';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * AttendanceManager Component
 * Manages attendance permissions for RSVP block
 *
 * @param {Object} props Component props
 * @param {Object} props.attendance Current attendance object
 * @param {Function} props.onChange Callback when attendance changes
 */
export default function AttendanceManager({ attendance, onChange }) {
	const [selectedRule, setSelectedRule] = useState('');
	const [pluginGroups, setPluginGroups] = useState([]);

	// Get available WordPress roles
	const availableRoles = [
		{
			label: __('Administrator', 'fair-rsvp'),
			value: 'role:administrator',
		},
		{ label: __('Editor', 'fair-rsvp'), value: 'role:editor' },
		{ label: __('Author', 'fair-rsvp'), value: 'role:author' },
		{ label: __('Contributor', 'fair-rsvp'), value: 'role:contributor' },
		{ label: __('Subscriber', 'fair-rsvp'), value: 'role:subscriber' },
	];

	// Permission level options
	const permissionLevels = [
		{ label: __('Not Allowed (0)', 'fair-rsvp'), value: 0 },
		{ label: __('Allowed (1)', 'fair-rsvp'), value: 1 },
		{ label: __('Expected (2)', 'fair-rsvp'), value: 2 },
	];

	// Fetch plugin-provided user groups on mount
	useEffect(() => {
		apiFetch({ path: '/fair-events/v1/user-group-options' })
			.then((response) => {
				if (response.success && Array.isArray(response.options)) {
					setPluginGroups(response.options);
				}
			})
			.catch((error) => {
				// Silently fail - plugin groups are optional
				console.error('Failed to load user group options:', error);
			});
	}, []);

	// Get display label for a key
	const getDisplayLabel = (key) => {
		if (key === 'users') {
			return __('All Logged-in Users', 'fair-rsvp');
		}
		if (key === 'anonymous') {
			return __('Anonymous Users', 'fair-rsvp');
		}
		if (key.startsWith('role:')) {
			const roleName = key.replace('role:', '');
			const roleLabel = availableRoles.find((r) => r.value === key);
			return roleLabel
				? roleLabel.label + __(' (Role)', 'fair-rsvp')
				: roleName.charAt(0).toUpperCase() +
						roleName.slice(1) +
						__(' (Role)', 'fair-rsvp');
		}
		// Check if it's a plugin-provided group
		const pluginGroup = pluginGroups.find((g) => g.value === key);
		if (pluginGroup) {
			return pluginGroup.label;
		}
		return key;
	};

	// Get permission label
	const getPermissionLabel = (value) => {
		const level = permissionLevels.find((p) => p.value === parseInt(value));
		return level ? level.label : value;
	};

	// Add a new rule
	const addRule = () => {
		if (!selectedRule || attendance[selectedRule] !== undefined) {
			return;
		}

		const newAttendance = {
			...attendance,
			[selectedRule]: 1, // Default to "Allowed"
		};
		onChange(newAttendance);
		setSelectedRule('');
	};

	// Update permission level for a key
	const updatePermission = (key, value) => {
		const newAttendance = {
			...attendance,
			[key]: parseInt(value),
		};
		onChange(newAttendance);
	};

	// Remove a rule
	const removeRule = (key) => {
		const newAttendance = { ...attendance };
		delete newAttendance[key];
		onChange(newAttendance);
	};

	// Get add rule options (exclude already added rules)
	const getAddRuleOptions = () => {
		const options = [
			{ label: __('Select a rule to add...', 'fair-rsvp'), value: '' },
			{
				label: __('All Logged-in Users', 'fair-rsvp'),
				value: 'users',
				disabled: attendance.users !== undefined,
			},
			{
				label: __('Anonymous Users', 'fair-rsvp'),
				value: 'anonymous',
				disabled: attendance.anonymous !== undefined,
			},
			...availableRoles.map((role) => ({
				...role,
				disabled: attendance[role.value] !== undefined,
			})),
			...pluginGroups.map((group) => ({
				label: group.label,
				value: group.value,
				disabled: attendance[group.value] !== undefined,
			})),
		];
		return options;
	};

	// Count stats
	const ruleCount = Object.keys(attendance).length;
	const expectedCount = Object.values(attendance).filter(
		(v) => parseInt(v) === 2
	).length;
	const allowedCount = Object.values(attendance).filter(
		(v) => parseInt(v) === 1
	).length;
	const blockedCount = Object.values(attendance).filter(
		(v) => parseInt(v) === 0
	).length;

	return (
		<div className="fair-rsvp-attendance-manager">
			{ruleCount === 0 ? (
				<Notice status="info" isDismissible={false}>
					{__(
						'No restrictions set. Everyone can RSVP (default behavior).',
						'fair-rsvp'
					)}
				</Notice>
			) : (
				<Notice status="success" isDismissible={false}>
					{expectedCount > 0 &&
						`${expectedCount} ${
							expectedCount === 1
								? __('group expected.', 'fair-rsvp')
								: __('groups expected.', 'fair-rsvp')
						} `}
					{allowedCount > 0 &&
						`${allowedCount} ${
							allowedCount === 1
								? __('group allowed.', 'fair-rsvp')
								: __('groups allowed.', 'fair-rsvp')
						} `}
					{blockedCount > 0 &&
						`${blockedCount} ${
							blockedCount === 1
								? __('group blocked.', 'fair-rsvp')
								: __('groups blocked.', 'fair-rsvp')
						}`}
				</Notice>
			)}

			{ruleCount > 0 && (
				<div className="fair-rsvp-attendance-rules">
					<table className="widefat striped">
						<thead>
							<tr>
								<th>{__('Group', 'fair-rsvp')}</th>
								<th>{__('Permission', 'fair-rsvp')}</th>
								<th>{__('Action', 'fair-rsvp')}</th>
							</tr>
						</thead>
						<tbody>
							{Object.entries(attendance).map(([key, value]) => (
								<tr key={key}>
									<td>{getDisplayLabel(key)}</td>
									<td>
										<SelectControl
											value={value}
											options={permissionLevels}
											onChange={(newValue) =>
												updatePermission(key, newValue)
											}
											__nextHasNoMarginBottom
										/>
									</td>
									<td>
										<Button
											isDestructive
											variant="secondary"
											isSmall
											onClick={() => removeRule(key)}
										>
											{__('Remove', 'fair-rsvp')}
										</Button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<div
				className="fair-rsvp-add-rule"
				style={{ marginTop: '16px', display: 'flex', gap: '8px' }}
			>
				<SelectControl
					value={selectedRule}
					options={getAddRuleOptions()}
					onChange={setSelectedRule}
					style={{ flex: 1 }}
					__nextHasNoMarginBottom
				/>
				<Button
					variant="secondary"
					onClick={addRule}
					disabled={
						!selectedRule || attendance[selectedRule] !== undefined
					}
				>
					{__('Add Rule', 'fair-rsvp')}
				</Button>
			</div>
		</div>
	);
}
