/**
 * Switching Statistics, ticket counts and capacity to the records Fair
 * Events owns: the stage 5 reader activation and its blockers
 * (PAYMENT_HISTORY_MIGRATION.md §8.14).
 *
 * @package FairEvents
 */

import { __, _n, sprintf } from '@wordpress/i18n';
import { useRef, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import ConfirmActionModal from '../components/ConfirmActionModal.js';
import { readerBlockerLabels } from './labels.js';
import { formatUtcDateTime } from './format.js';

/**
 * The statistics switch card.
 *
 * @param {Object}   props
 * @param {Object}   props.readers  Reader state from the API (`status.readers`).
 * @param {Function} props.onAction Runs a control: (path, data) => Promise.
 * @return {JSX.Element} Card.
 */
export default function ReadersPanel( { readers, onAction } ) {
	const [ confirming, setConfirming ] = useState( false );
	const [ pending, setPending ] = useState( false );
	const [ error, setError ] = useState( null );
	const busy = useRef( false );

	const activation = readers.activation;
	const blockers = readers.blockers || [];
	const dates = readers.relationship_admissions || [];

	const close = () => {
		setConfirming( false );
		setError( null );
	};

	const activate = async () => {
		if ( busy.current ) {
			return;
		}
		busy.current = true;
		setPending( true );
		setError( null );
		try {
			await onAction( '/readers', {} );
			close();
		} catch ( e ) {
			setError(
				e?.message ||
					__(
						'The request failed. Check your connection and try again.',
						'fair-events'
					)
			);
		} finally {
			busy.current = false;
			setPending( false );
		}
	};

	let activationText = null;
	if ( activation?.reason === 'no_source_history' ) {
		activationText = __(
			'Statistics use Fair Events records. This site had no earlier Fair Audience records to move.',
			'fair-events'
		);
	} else if ( activation?.user_name ) {
		activationText = sprintf(
			/* translators: 1: date and time of the switch, 2: administrator's name */
			__(
				'Statistics use Fair Events records since %1$s. Switched by %2$s.',
				'fair-events'
			),
			formatUtcDateTime( activation.activated_at ),
			activation.user_name
		);
	} else if ( activation ) {
		activationText = sprintf(
			/* translators: %s: date and time of the switch */
			__( 'Statistics use Fair Events records since %s.', 'fair-events' ),
			formatUtcDateTime( activation.activated_at )
		);
	}

	return (
		<Card className="fair-events-payment-history__card">
			<CardHeader>
				<h2>{ __( 'Statistics', 'fair-events' ) }</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 4 }>
					{ activation ? (
						<Notice status="success" isDismissible={ false }>
							{ activationText }
						</Notice>
					) : (
						<p className="fair-events-payment-history__intro">
							{ __(
								'Statistics, ticket counts and capacity still read Fair Audience’s registrations and payment records. After the switch they read only Fair Events: its tickets and the payments linked to them. They then work without Fair Audience, and a payment shared by several dates counts once.',
								'fair-events'
							) }
						</p>
					) }

					{ ! activation && blockers.length > 0 && (
						<Notice status="warning" isDismissible={ false }>
							<p>
								{ __(
									'Statistics can’t switch to Fair Events records yet:',
									'fair-events'
								) }
							</p>
							<ul className="fair-events-payment-history__list">
								{ blockers.map( ( code ) => (
									<li key={ code }>
										{ readerBlockerLabels()[ code ] ??
											code }
									</li>
								) ) }
							</ul>
							{ dates.length > 0 && (
								<p>
									{ sprintf(
										/* translators: %s: comma-separated event date IDs. */
										_n(
											'Event date: %s',
											'Event dates: %s',
											dates.length,
											'fair-events'
										),
										dates.join( ', ' )
									) }
								</p>
							) }
						</Notice>
					) }

					{ activation ? (
						<p className="fair-events-payment-history__hint">
							{ __(
								'The switch can’t be undone. Fair Audience’s records stay as they were.',
								'fair-events'
							) }
						</p>
					) : (
						<div>
							<Button
								variant="primary"
								onClick={ () => setConfirming( true ) }
								disabled={ blockers.length > 0 }
								accessibleWhenDisabled
							>
								{ __(
									'Switch statistics to Fair Events',
									'fair-events'
								) }
							</Button>
						</div>
					) }
				</VStack>
			</CardBody>

			{ confirming && (
				<ConfirmActionModal
					title={ __(
						'Switch statistics to Fair Events',
						'fair-events'
					) }
					confirmLabel={ __( 'Switch statistics', 'fair-events' ) }
					busyLabel={ __( 'Switching…', 'fair-events' ) }
					isBusy={ pending }
					error={ error }
					onCancel={ close }
					onConfirm={ activate }
				>
					<p>
						{ __(
							'From now on Statistics, ticket counts and capacity read only Fair Events’ tickets and the payments linked to them.',
							'fair-events'
						) }
					</p>
					<p>
						{ __(
							'Revenue for a date then counts only its own share of a payment shared by several dates, and series pass revenue counts once, on the series’ first date. Other dates of the series show it separately.',
							'fair-events'
						) }
					</p>
					<p>
						{ __(
							'It doesn’t change, charge, refund or email anything, and it can’t be undone.',
							'fair-events'
						) }
					</p>
				</ConfirmActionModal>
			) }
		</Card>
	);
}
