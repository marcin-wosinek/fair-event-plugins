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

const VenuesApp = () => {
	const [venues, setVenues] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingVenue, setEditingVenue] = useState(null);
	const [formData, setFormData] = useState({ name: '', address: '' });
	const [isSaving, setIsSaving] = useState(false);

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
		setFormData({ name: '', address: '' });
		setIsFormOpen(true);
	};

	const handleEdit = (venue) => {
		setEditingVenue(venue);
		setFormData({ name: venue.name, address: venue.address || '' });
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

	return (
		<div className="fair-events-venues-page">
			<Card>
				<CardHeader>
					<HStack justify="space-between">
						<h1>{__('Venues', 'fair-events')}</h1>
						<Button variant="primary" onClick={handleCreate}>
							{__('Add New Venue', 'fair-events')}
						</Button>
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
										<th>{__('Name', 'fair-events')}</th>
										<th>{__('Address', 'fair-events')}</th>
										<th>{__('Actions', 'fair-events')}</th>
									</tr>
								</thead>
								<tbody>
									{venues.map((venue) => (
										<tr key={venue.id}>
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
					style={{ maxWidth: '500px' }}
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
