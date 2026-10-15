/**
 * WordPress dependencies
 */
import { useEffect } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { useSettlementImport } from '../../settlement-import/index.js';

export const MOLLIE_SETTLEMENTS_ACTION = 'load_mollie_settlements';

/**
 * Describe how far a run has come.
 *
 * @param {Object} run Settlement import run.
 * @return {string} Progress sentence.
 */
const progressText = ( run ) =>
	sprintf(
		/* translators: %d: number of settlements loaded so far */
		_n(
			'%d settlement loaded so far.',
			'%d settlements loaded so far.',
			run.progress.settlements_done,
			'fair-payments-connector'
		),
		run.progress.settlements_done
	);

/**
 * Name the kind of import a run is.
 *
 * @param {Object} run Settlement import run.
 * @return {string} Name.
 */
const kindText = ( run ) => {
	switch ( run.kind ) {
		case 'new':
			return __( 'Load new settlements', 'fair-payments-connector' );
		case 'refresh':
			return __( 'Refresh one settlement', 'fair-payments-connector' );
		default:
			return __( 'Reload all settlements', 'fair-payments-connector' );
	}
};

/**
 * Say what a finished import did.
 *
 * @param {Object} run Completed settlement import run.
 * @return {string} Result sentence.
 */
const completedText = ( run ) => {
	const done = run.progress.settlements_done;
	const skipped = run.progress.settlements_skipped || 0;

	if ( done === 0 && run.kind === 'new' ) {
		return skipped === 0
			? __(
					'Mollie lists no settlements yet.',
					'fair-payments-connector'
				)
			: sprintf(
					/* translators: %d: number of settlements already saved */
					_n(
						'Nothing new: the %d settlement Mollie lists is already saved.',
						'Nothing new: all %d settlements Mollie lists are already saved.',
						skipped,
						'fair-payments-connector'
					),
					skipped
				);
	}

	return sprintf(
		/* translators: %d: number of settlements loaded */
		_n(
			'Loaded %d settlement from Mollie.',
			'Loaded %d settlements from Mollie.',
			done,
			'fair-payments-connector'
		),
		done
	);
};

/**
 * Words for an import request that failed.
 *
 * @param {Object} error `{ phase, message }` from the import hook.
 * @return {string} Message.
 */
const errorText = ( error ) => {
	if ( error.message ) {
		return error.message;
	}

	switch ( error.phase ) {
		case 'start':
			return __(
				'The import could not be started.',
				'fair-payments-connector'
			);
		case 'refresh':
			return __(
				'The status of the import could not be read. Try again in a moment.',
				'fair-payments-connector'
			);
		default:
			return __(
				'The import could not continue. Its last known state is shown below.',
				'fair-payments-connector'
			);
	}
};

/**
 * Load Mollie settlements that are not saved yet.
 *
 * Shown while Fair Finance is active, where saved settlements are inspected.
 * It drives the same server-held import as the Settlements page there, so an
 * import left unfinished on either page can be continued on the other.
 *
 * @param {Object}   props
 * @param {string}   props.activeAction Key of the action running on the page, or null.
 * @param {Function} props.onBegin      Claims the page-wide busy state; returns false when busy.
 * @param {Function} props.onEnd        Releases the busy state and refreshes the log.
 * @return {JSX.Element} Panel.
 */
const MollieSettlementsPanel = ( { activeAction, onBegin, onEnd } ) => {
	const settings = window.fairPaymentsExternalUpdates || {};
	const { run, working, error, start, resume, refresh } = useSettlementImport(
		{
			onBegin: () => onBegin( MOLLIE_SETTLEMENTS_ACTION ),
			onEnd,
		}
	);

	// An import left unfinished here or in Fair Finance is offered again.
	useEffect( () => {
		refresh();
	}, [ refresh ] );

	// Every control below follows from the server's account of the run.
	const stopped = ! working && run?.resumable === true;
	const active = ! working && run?.status === 'running';
	const unfinished = stopped || active;
	const pageBusy = activeAction !== null;

	return (
		<Card>
			<CardHeader>
				<h2 className="fair-external-updates__title">
					{ __( 'Mollie settlements', 'fair-payments-connector' ) }
				</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 3 }>
					<p className="fair-external-updates__intro">
						{ __(
							'Load the Mollie settlements that are not saved here yet, with their payments, captures, refunds and chargebacks. Settlements already loaded from Mollie are left unchanged.',
							'fair-payments-connector'
						) }{ ' ' }
						<a href={ settings.settlementsUrl }>
							{ __(
								'Inspect or reload settlements in Fair Finance.',
								'fair-payments-connector'
							) }
						</a>
					</p>

					{ error && (
						<Notice status="error" isDismissible={ false }>
							{ errorText( error ) }
						</Notice>
					) }

					{ working && run && (
						<HStack justify="flex-start" role="status">
							<Spinner />
							<span>{ progressText( run ) }</span>
						</HStack>
					) }

					{ stopped && (
						<Notice status="warning" isDismissible={ false }>
							<strong>
								{ sprintf(
									/* translators: %s: kind of import, e.g. "Load new settlements" */
									__(
										'“%s” did not finish.',
										'fair-payments-connector'
									),
									kindText( run )
								) }
							</strong>{ ' ' }
							{ run.error_message } { progressText( run ) }{ ' ' }
							{ __(
								'Continue it, or start another import instead. Settlements that were fully loaded stay saved either way.',
								'fair-payments-connector'
							) }
						</Notice>
					) }

					{ active && (
						<Notice status="info" isDismissible={ false }>
							<strong>
								{ sprintf(
									/* translators: %s: kind of import, e.g. "Load new settlements" */
									__(
										'“%s” is running.',
										'fair-payments-connector'
									),
									kindText( run )
								) }
							</strong>{ ' ' }
							{ progressText( run ) }{ ' ' }
							{ __(
								'It may be running in another window. Another import can be started once this one finishes, or after it has made no progress for five minutes.',
								'fair-payments-connector'
							) }
						</Notice>
					) }

					{ ! working && run?.status === 'aborted' && (
						<Notice status="error" isDismissible={ false }>
							{ run.error_message }
						</Notice>
					) }

					{ ! working && run?.status === 'completed' && (
						<Notice status="success" isDismissible={ false }>
							{ completedText( run ) }
						</Notice>
					) }

					<HStack justify="flex-start" wrap>
						{ unfinished && (
							<Button
								variant={ stopped ? 'primary' : 'secondary' }
								onClick={ resume }
								disabled={ pageBusy }
							>
								{ __(
									'Continue import',
									'fair-payments-connector'
								) }
							</Button>
						) }
						{ active && (
							<Button
								variant="primary"
								onClick={ refresh }
								disabled={ pageBusy }
							>
								{ __(
									'Refresh status',
									'fair-payments-connector'
								) }
							</Button>
						) }
						<Button
							variant={ unfinished ? 'secondary' : 'primary' }
							onClick={ () => start( 'new' ) }
							isBusy={ working }
							disabled={ pageBusy || active }
						>
							{ working
								? __(
										'Loading settlements…',
										'fair-payments-connector'
									)
								: __(
										'Load new settlements',
										'fair-payments-connector'
									) }
						</Button>
					</HStack>
				</VStack>
			</CardBody>
		</Card>
	);
};

export default MollieSettlementsPanel;
