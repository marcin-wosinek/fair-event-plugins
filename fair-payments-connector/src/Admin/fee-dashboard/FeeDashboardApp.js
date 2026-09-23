/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Spinner,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const siteCurrency = window.fairPaymentsConnector?.currency || 'EUR';

const formatEur = ( amount ) =>
	new Intl.NumberFormat( 'de-DE', {
		style: 'currency',
		currency: siteCurrency,
	} ).format( amount ?? 0 );

const StatCard = ( { label, children } ) => (
	<Card>
		<CardHeader>
			<h3 style={ { margin: 0 } }>{ label }</h3>
		</CardHeader>
		<CardBody>{ children }</CardBody>
	</Card>
);

const FeeDashboardApp = () => {
	const [ summary, setSummary ] = useState( null );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );

	useEffect( () => {
		apiFetch( {
			path: '/fair-payments-connector/v1/dashboard/monthly-summary',
		} )
			.then( ( data ) => setSummary( data ) )
			.catch( ( err ) =>
				setError(
					err.message ||
						__(
							'Failed to load dashboard data.',
							'fair-payments-connector'
						)
				)
			)
			.finally( () => setLoading( false ) );
	}, [] );

	const monthLabel = summary?.month
		? new Date( summary.month + '-01' ).toLocaleString( 'default', {
				month: 'long',
				year: 'numeric',
		  } )
		: '';

	return (
		<div className="wrap fair-payments-connector-fee-dashboard-page">
			<VStack spacing={ 4 }>
				<HStack justify="space-between" align="center">
					<h1 style={ { margin: 0 } }>
						{ __( 'Fee Dashboard', 'fair-payments-connector' ) }
					</h1>
					{ monthLabel && (
						<span style={ { color: '#666' } }>{ monthLabel }</span>
					) }
				</HStack>

				<p style={ { margin: 0 } }>
					{ sprintf(
						/* translators: %d: integration fee percentage */
						__(
							'The integration fee is %d%% of ticket sales, with no monthly cap. It is waived through 31 December 2026. Mollie processing fees apply separately.',
							'fair-payments-connector'
						),
						2
					) }
				</p>

				{ summary?.testmode && (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'Test mode — these figures reflect test transactions only.',
							'fair-payments-connector'
						) }
					</Notice>
				) }

				{ error && (
					<Notice
						status="error"
						isDismissible
						onRemove={ () => setError( null ) }
					>
						{ error }
					</Notice>
				) }

				{ loading && (
					<div>
						<Spinner />
					</div>
				) }

				{ ! loading && summary && (
					<VStack spacing={ 4 }>
						<StatCard
							label={ __(
								'Total payment volume this month',
								'fair-payments-connector'
							) }
						>
							<p style={ { fontSize: '1.5em', margin: 0 } }>
								{ formatEur( summary.total_volume ) }
							</p>
						</StatCard>

						<StatCard
							label={ __(
								'Integration fees this month',
								'fair-payments-connector'
							) }
						>
							<p style={ { fontSize: '1.5em', margin: 0 } }>
								{ formatEur( summary.total_fees ) }
							</p>
						</StatCard>
					</VStack>
				) }
			</VStack>
		</div>
	);
};

export default FeeDashboardApp;
