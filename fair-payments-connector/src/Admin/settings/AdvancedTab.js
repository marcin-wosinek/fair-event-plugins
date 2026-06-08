/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import { Card, CardBody } from '@wordpress/components';

/**
 * Internal dependencies
 */
import { loadAdvancedSettings, formatSettingValue } from './settings-api';

/**
 * Advanced Tab Component
 *
 * Displays all Mollie-related settings for troubleshooting.
 * Manages its own loading state and data fetching.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying notices
 * @return {JSX.Element} The advanced tab
 */
export default function AdvancedTab({ onNotice }) {
	const [allSettings, setAllSettings] = useState({});
	const [isLoading, setIsLoading] = useState(false);

	/**
	 * Load advanced settings from API
	 */
	const loadSettings = () => {
		if (isLoading) {
			console.log(
				'[Fair Payments Connector] Skipping loadSettings - already loading'
			);
			return;
		}

		setIsLoading(true);

		loadAdvancedSettings()
			.then((settings) => {
				setAllSettings(settings);
				setIsLoading(false);
			})
			.catch((error) => {
				console.error(
					'[Fair Payments Connector] Failed to load advanced settings:',
					error
				);
				onNotice({
					status: 'error',
					message: __(
						'Failed to load advanced settings.',
						'fair-payments-connector'
					),
				});
				setIsLoading(false);
			});
	};

	/**
	 * Load settings on mount
	 */
	useEffect(() => {
		loadSettings();
	}, []);

	return (
		<Card>
			<CardBody>
				<h2>{__('Advanced Settings', 'fair-payments-connector')}</h2>
				<p style={{ color: '#666', marginBottom: '1.5rem' }}>
					{__(
						'All Mollie-related settings stored in the database. For troubleshooting purposes only.',
						'fair-payments-connector'
					)}
				</p>

				{isLoading ? (
					<p>
						{__('Loading settings...', 'fair-payments-connector')}
					</p>
				) : (
					<table
						className="widefat fixed striped"
						style={{ marginTop: '1rem' }}
					>
						<thead>
							<tr>
								<th style={{ width: '40%' }}>
									{__(
										'Setting Name',
										'fair-payments-connector'
									)}
								</th>
								<th>
									{__('Value', 'fair-payments-connector')}
								</th>
							</tr>
						</thead>
						<tbody>
							{Object.entries(allSettings).map(([key, value]) => {
								const displayValue = formatSettingValue(
									key,
									value
								);

								return (
									<tr key={key}>
										<td>
											<code
												style={{
													fontSize: '0.9em',
												}}
											>
												{key}
											</code>
										</td>
										<td>
											{displayValue === '' ? (
												<em
													style={{
														color: '#999',
													}}
												>
													{__(
														'(empty)',
														'fair-payments-connector'
													)}
												</em>
											) : (
												<code
													style={{
														fontSize: '0.9em',
														wordBreak: 'break-all',
													}}
												>
													{displayValue}
												</code>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</CardBody>
		</Card>
	);
}
