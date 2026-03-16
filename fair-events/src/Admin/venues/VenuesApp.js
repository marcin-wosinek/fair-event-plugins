/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	Modal,
	TextControl,
	TextareaControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const VENUE_FIELDS = [
	'name',
	'address',
	'google_maps_link',
	'latitude',
	'longitude',
	'facebook_page_link',
	'instagram_handle',
	'website_url',
];

const VenuesApp = () => {
	const [venues, setVenues] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingVenue, setEditingVenue] = useState(null);
	const [formData, setFormData] = useState({
		name: '',
		address: '',
		google_maps_link: '',
		latitude: '',
		longitude: '',
		facebook_page_link: '',
		instagram_handle: '',
		website_url: '',
	});
	const [isSaving, setIsSaving] = useState(false);
	const [selectedVenues, setSelectedVenues] = useState(new Set());
	const [isImporting, setIsImporting] = useState(false);

	useEffect(() => {
		loadVenues();
	}, []);

	const loadVenues = async () => {
		setLoading(true);
		setError(null);

		try {
			const data = await apiFetch({
				path: '/fair-events/v1/venues',
			});
			setVenues(data);
		} catch (err) {
			setError(
				err.message || __('Failed to load venues.', 'fair-events')
			);
		} finally {
			setLoading(false);
		}
	};

	const handleCreate = () => {
		setEditingVenue(null);
		setFormData({
			name: '',
			address: '',
			google_maps_link: '',
			latitude: '',
			longitude: '',
			facebook_page_link: '',
			instagram_handle: '',
		});
		setIsFormOpen(true);
	};

	const handleEdit = (venue) => {
		setEditingVenue(venue);
		setFormData({
			name: venue.name,
			address: venue.address || '',
			google_maps_link: venue.google_maps_link || '',
			latitude: venue.latitude || '',
			longitude: venue.longitude || '',
			facebook_page_link: venue.facebook_page_link || '',
			instagram_handle: venue.instagram_handle || '',
			website_url: venue.website_url || '',
		});
		setIsFormOpen(true);
	};

	const handleDelete = async (id) => {
		if (
			!window.confirm(
				__('Are you sure you want to delete this venue?', 'fair-events')
			)
		) {
			return;
		}

		setError(null);
		setSuccess(null);

		try {
			await apiFetch({
				path: `/fair-events/v1/venues/${id}`,
				method: 'DELETE',
			});
			setSuccess(__('Venue deleted successfully.', 'fair-events'));
			loadVenues();
		} catch (err) {
			setError(
				err.message || __('Failed to delete venue.', 'fair-events')
			);
		}
	};

	const handleFormSubmit = async (e) => {
		e.preventDefault();
		setIsSaving(true);
		setError(null);

		try {
			if (editingVenue) {
				await apiFetch({
					path: `/fair-events/v1/venues/${editingVenue.id}`,
					method: 'PUT',
					data: formData,
				});
				setSuccess(__('Venue updated successfully.', 'fair-events'));
			} else {
				await apiFetch({
					path: '/fair-events/v1/venues',
					method: 'POST',
					data: formData,
				});
				setSuccess(__('Venue created successfully.', 'fair-events'));
			}
			setIsFormOpen(false);
			setEditingVenue(null);
			loadVenues();
		} catch (err) {
			setError(
				err.message ||
					(editingVenue
						? __('Failed to update venue.', 'fair-events')
						: __('Failed to create venue.', 'fair-events'))
			);
		} finally {
			setIsSaving(false);
		}
	};

	const handleFormCancel = () => {
		setIsFormOpen(false);
		setEditingVenue(null);
	};

	const toggleVenueSelection = (id) => {
		setSelectedVenues((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const toggleAllVenues = () => {
		if (selectedVenues.size === venues.length) {
			setSelectedVenues(new Set());
		} else {
			setSelectedVenues(new Set(venues.map((v) => v.id)));
		}
	};

	const handleExport = () => {
		const venuesToExport = venues
			.filter((v) => selectedVenues.has(v.id))
			.map((v) => {
				const exported = {};
				VENUE_FIELDS.forEach((field) => {
					if (v[field]) {
						exported[field] = v[field];
					}
				});
				return exported;
			});

		const blob = new Blob([JSON.stringify(venuesToExport, null, 2)], {
			type: 'application/json',
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'venues.json';
		a.click();
		URL.revokeObjectURL(url);
		setSuccess(
			// translators: %d is the number of exported venues
			__('%d venue(s) exported.', 'fair-events').replace(
				'%d',
				venuesToExport.length
			)
		);
	};

	const handleImport = async (e) => {
		const file = e.target.files[0];
		if (!file) {
			return;
		}

		// Reset the input so the same file can be re-selected
		e.target.value = '';

		setIsImporting(true);
		setError(null);
		setSuccess(null);

		try {
			const text = await file.text();
			const importedVenues = JSON.parse(text);

			if (!Array.isArray(importedVenues)) {
				throw new Error(
					__(
						'Invalid file format. Expected a JSON array.',
						'fair-events'
					)
				);
			}

			let created = 0;
			for (const venue of importedVenues) {
				if (!venue.name) {
					continue;
				}
				const data = {};
				VENUE_FIELDS.forEach((field) => {
					if (venue[field]) {
						data[field] = venue[field];
					}
				});
				await apiFetch({
					path: '/fair-events/v1/venues',
					method: 'POST',
					data,
				});
				created++;
			}

			setSuccess(
				// translators: %d is the number of imported venues
				__('%d venue(s) imported.', 'fair-events').replace(
					'%d',
					created
				)
			);
			loadVenues();
		} catch (err) {
			setError(
				err.message || __('Failed to import venues.', 'fair-events')
			);
		} finally {
			setIsImporting(false);
		}
	};

	return (
		<div className="fair-events-venues-page">
			<Card>
				<CardHeader>
					<HStack justify="space-between">
						<h1>{__('Venues', 'fair-events')}</h1>
						<HStack spacing={2} expanded={false}>
							{selectedVenues.size > 0 && (
								<Button
									variant="secondary"
									onClick={handleExport}
								>
									{__('Export Selected', 'fair-events')}
								</Button>
							)}
							<Button
								variant="secondary"
								onClick={() =>
									document
										.getElementById(
											'fair-events-venue-import'
										)
										.click()
								}
								isBusy={isImporting}
								disabled={isImporting}
							>
								{__('Import', 'fair-events')}
							</Button>
							<input
								id="fair-events-venue-import"
								type="file"
								accept=".json"
								style={{ display: 'none' }}
								onChange={handleImport}
							/>
							<Button variant="primary" onClick={handleCreate}>
								{__('Add New Venue', 'fair-events')}
							</Button>
						</HStack>
					</HStack>
				</CardHeader>
				<CardBody>
					<VStack spacing={4}>
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

						{loading && (
							<div className="venues-loading">
								<Spinner />
								<p>{__('Loading venues...', 'fair-events')}</p>
							</div>
						)}

						{!loading && venues.length === 0 && (
							<div className="venues-empty">
								<p>
									{__(
										'No venues found. Create your first venue to get started.',
										'fair-events'
									)}
								</p>
							</div>
						)}

						{!loading && venues.length > 0 && (
							<table className="wp-list-table widefat fixed striped">
								<thead>
									<tr>
										<td className="check-column">
											<input
												type="checkbox"
												checked={
													selectedVenues.size ===
													venues.length
												}
												onChange={toggleAllVenues}
											/>
										</td>
										<th>{__('Name', 'fair-events')}</th>
										<th>{__('Address', 'fair-events')}</th>
										<th>{__('Actions', 'fair-events')}</th>
									</tr>
								</thead>
								<tbody>
									{venues.map((venue) => (
										<tr key={venue.id}>
											<th className="check-column">
												<input
													type="checkbox"
													checked={selectedVenues.has(
														venue.id
													)}
													onChange={() =>
														toggleVenueSelection(
															venue.id
														)
													}
												/>
											</th>
											<td>
												<strong>{venue.name}</strong>
											</td>
											<td>
												{venue.address || (
													<em>
														{__(
															'No address',
															'fair-events'
														)}
													</em>
												)}
											</td>
											<td>
												<HStack spacing={2}>
													<Button
														variant="secondary"
														size="small"
														onClick={() =>
															handleEdit(venue)
														}
													>
														{__(
															'Edit',
															'fair-events'
														)}
													</Button>
													<Button
														variant="tertiary"
														size="small"
														isDestructive
														onClick={() =>
															handleDelete(
																venue.id
															)
														}
													>
														{__(
															'Delete',
															'fair-events'
														)}
													</Button>
												</HStack>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</VStack>
				</CardBody>
			</Card>

			{isFormOpen && (
				<Modal
					title={
						editingVenue
							? __('Edit Venue', 'fair-events')
							: __('Add New Venue', 'fair-events')
					}
					onRequestClose={handleFormCancel}
					style={{ maxWidth: '500px', width: '100%' }}
				>
					<form onSubmit={handleFormSubmit}>
						<VStack spacing={4}>
							<TextControl
								label={__('Name', 'fair-events')}
								value={formData.name}
								onChange={(value) =>
									setFormData({ ...formData, name: value })
								}
								required
							/>
							<TextareaControl
								label={__('Address', 'fair-events')}
								value={formData.address}
								onChange={(value) =>
									setFormData({
										...formData,
										address: value,
									})
								}
								help={__(
									'Full address of the venue',
									'fair-events'
								)}
							/>
							<TextControl
								label={__('Google Maps Link', 'fair-events')}
								value={formData.google_maps_link}
								onChange={(value) =>
									setFormData({
										...formData,
										google_maps_link: value,
									})
								}
								type="url"
								help={__(
									'URL to Google Maps location',
									'fair-events'
								)}
							/>
							<TextControl
								label={__('Latitude', 'fair-events')}
								value={formData.latitude}
								onChange={(value) =>
									setFormData({
										...formData,
										latitude: value,
									})
								}
								help={__(
									'Latitude coordinate (e.g., 39.4878023)',
									'fair-events'
								)}
							/>
							<TextControl
								label={__('Longitude', 'fair-events')}
								value={formData.longitude}
								onChange={(value) =>
									setFormData({
										...formData,
										longitude: value,
									})
								}
								help={__(
									'Longitude coordinate (e.g., -0.3613204)',
									'fair-events'
								)}
							/>
							<TextControl
								label={__('Facebook Page Link', 'fair-events')}
								value={formData.facebook_page_link}
								onChange={(value) =>
									setFormData({
										...formData,
										facebook_page_link: value,
									})
								}
								type="url"
								help={__('URL to Facebook page', 'fair-events')}
							/>
							<TextControl
								label={__('Instagram Handle', 'fair-events')}
								value={formData.instagram_handle}
								onChange={(value) =>
									setFormData({
										...formData,
										instagram_handle: value,
									})
								}
								help={__(
									'Instagram username without @ (e.g., venue_name)',
									'fair-events'
								)}
							/>
							<TextControl
								label={__('Website URL', 'fair-events')}
								value={formData.website_url}
								onChange={(value) =>
									setFormData({
										...formData,
										website_url: value,
									})
								}
								type="url"
								help={__(
									'Website URL of the venue',
									'fair-events'
								)}
							/>
							<HStack justify="flex-end" spacing={2}>
								<Button
									variant="tertiary"
									onClick={handleFormCancel}
									disabled={isSaving}
								>
									{__('Cancel', 'fair-events')}
								</Button>
								<Button
									variant="primary"
									type="submit"
									isBusy={isSaving}
									disabled={isSaving || !formData.name}
								>
									{editingVenue
										? __('Update Venue', 'fair-events')
										: __('Create Venue', 'fair-events')}
								</Button>
							</HStack>
						</VStack>
					</form>
				</Modal>
			)}
		</div>
	);
};

export default VenuesApp;
