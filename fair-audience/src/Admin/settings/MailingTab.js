/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	Button,
	CheckboxControl,
	Spinner,
	Card,
	CardBody,
	CardHeader,
} from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import { saveSettings } from './settings-api.js';

/**
 * MailingTab Component
 *
 * Allows selecting which WordPress categories are used for marketing mailing.
 *
 * @param {Object}   props          Component props.
 * @param {Function} props.onNotice Callback to show notices.
 * @return {JSX.Element} The mailing tab
 */
export default function MailingTab({ onNotice }) {
	const [categories, setCategories] = useState([]);
	const [selectedIds, setSelectedIds] = useState([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		Promise.all([
			apiFetch({
				path: '/wp/v2/categories?per_page=100&hide_empty=false',
			}),
			apiFetch({ path: '/wp/v2/settings' }),
		])
			.then(([cats, settings]) => {
				setCategories(cats);
				setSelectedIds(
					settings.fair_audience_mailing_category_ids || []
				);
			})
			.catch((err) => {
				onNotice({
					status: 'error',
					message:
						__('Failed to load categories: ', 'fair-audience') +
						(err.message || 'Unknown error'),
				});
			})
			.finally(() => setLoading(false));
	}, []);

	const handleToggle = (categoryId, checked) => {
		setSelectedIds((prev) =>
			checked
				? [...prev, categoryId]
				: prev.filter((id) => id !== categoryId)
		);
	};

	const handleSave = () => {
		setSaving(true);
		saveSettings({ fair_audience_mailing_category_ids: selectedIds })
			.then(() => {
				onNotice({
					status: 'success',
					message: __('Mailing categories saved.', 'fair-audience'),
				});
			})
			.catch((err) => {
				onNotice({
					status: 'error',
					message:
						__('Failed to save: ', 'fair-audience') +
						(err.message || 'Unknown error'),
				});
			})
			.finally(() => setSaving(false));
	};

	if (loading) {
		return <Spinner />;
	}

	return (
		<Card>
			<CardHeader>
				<h2 style={{ margin: 0 }}>
					{__('Marketing mailing categories', 'fair-audience')}
				</h2>
			</CardHeader>
			<CardBody>
				<p>
					{__(
						'Select which categories should be available for marketing mailing. Subscribers will be able to choose which of these categories they want to receive updates about.',
						'fair-audience'
					)}
				</p>

				{categories.length === 0 ? (
					<p>
						<em>{__('No categories found.', 'fair-audience')}</em>
					</p>
				) : (
					<div style={{ marginBottom: '16px' }}>
						{categories.map((cat) => (
							<CheckboxControl
								key={cat.id}
								label={cat.name}
								checked={selectedIds.includes(cat.id)}
								onChange={(checked) =>
									handleToggle(cat.id, checked)
								}
							/>
						))}
					</div>
				)}

				<Button
					variant="primary"
					onClick={handleSave}
					isBusy={saving}
					disabled={saving}
				>
					{__('Save', 'fair-audience')}
				</Button>
			</CardBody>
		</Card>
	);
}
