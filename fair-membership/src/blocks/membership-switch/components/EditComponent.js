import { PanelBody, CheckboxControl, Spinner } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';

export default function EditComponent({ attributes, setAttributes }) {
	const { groupIds } = attributes;
	const [groups, setGroups] = useState([]);
	const [isLoadingGroups, setIsLoadingGroups] = useState(true);

	const blockProps = useBlockProps({
		className: 'membership-switch-container',
	});

	// Fetch available groups
	useEffect(() => {
		setIsLoadingGroups(true);
		apiFetch({ path: '/fair-membership/v1/groups' })
			.then((fetchedGroups) => {
				setGroups(fetchedGroups);
				setIsLoadingGroups(false);
			})
			.catch((error) => {
				console.error('Error fetching groups:', error);
				setGroups([]);
				setIsLoadingGroups(false);
			});
	}, []);

	// Only allow the two child blocks
	const allowedBlocks = [
		'fair-membership/member-content',
		'fair-membership/non-member-content',
	];

	// Template with exactly one of each child block
	const template = [
		['fair-membership/member-content'],
		['fair-membership/non-member-content'],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'membership-switch-content',
		},
		{
			allowedBlocks,
			template,
			templateLock: 'all', // Prevent adding/removing/reordering blocks
		}
	);

	const handleGroupToggle = (groupId) => {
		const newGroupIds = groupIds.includes(groupId)
			? groupIds.filter((id) => id !== groupId)
			: [...groupIds, groupId];
		setAttributes({ groupIds: newGroupIds });
	};

	return (
		<>
			<InspectorControls>
				<PanelBody title={__('Membership Settings', 'fair-membership')}>
					<p>
						{__(
							'Select which membership groups should see the member content:',
							'fair-membership'
						)}
					</p>
					{isLoadingGroups && <Spinner />}
					{!isLoadingGroups && groups.length === 0 && (
						<p>
							{__(
								'No membership groups found. Create groups first.',
								'fair-membership'
							)}
						</p>
					)}
					{!isLoadingGroups &&
						groups.map((group) => (
							<CheckboxControl
								key={group.id}
								label={group.name}
								checked={groupIds.includes(group.id)}
								onChange={() => handleGroupToggle(group.id)}
								help={
									group.description ? group.description : null
								}
							/>
						))}
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
