/**
 * WordPress dependencies
 */
import { useEffect } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	Button,
	Card,
	CardBody,
	Notice,
	Spinner,
	__experimentalHStack as HStack,
	__experimentalText as Text,
	__experimentalVStack as VStack,
} from '@wordpress/components';

/**
 * External dependencies
 */
import { useSettlementImport } from 'fair-payments-connector/src/Admin/settlement-import/index.js';

/**
 * Internal dependencies
 */
import { importErrorText } from '../format.js';

const SETTINGS_URL = 'admin.php?page=fair-payments-connector-settings';

/**
 * Describe how far a run has come.
 *
 * @param {Object} run Import run.
 * @return {string} Progress sentence.
 */
const progressText = ( run ) => {
	const done = run.progress.settlements_done;
	return sprintf(
		/* translators: %d: number of settlements loaded so far */
		_n(
			'%d settlement loaded so far.',
			'%d settlements loaded so far.',
			done,
			'fair-finance'
		),
		done
	);
};

/**
 * Say which import stopped before it finished.
 *
 * @param {Object} run Import run.
 * @return {string} Sentence naming the import.
 */
const unfinishedText = ( run ) => {
	switch ( run.kind ) {
		case 'new':
			return __( 'A “Load new” import did not finish.', 'fair-finance' );
		case 'refresh':
			return __(
				'A refresh of one settlement did not finish.',
				'fair-finance'
			);
		default:
			return __(
				'A “Reload all” import did not finish.',
				'fair-finance'
			);
	}
};

/**
 * Say which import the server still counts as running.
 *
 * @param {Object} run Import run.
 * @return {string} Sentence naming the import.
 */
const activeText = ( run ) => {
	switch ( run.kind ) {
		case 'new':
			return __( 'A “Load new” import is running.', 'fair-finance' );
		case 'refresh':
			return __(
				'A refresh of one settlement is running.',
				'fair-finance'
			);
		default:
			return __( 'A “Reload all” import is running.', 'fair-finance' );
	}
};

/**
 * Say what a finished import did.
 *
 * @param {Object} run Completed import run.
 * @return {string} Result sentence.
 */
const completedText = ( run ) => {
	const done = run.progress.settlements_done;
	const skipped = run.progress.settlements_skipped || 0;

	if ( run.kind !== 'new' ) {
		return sprintf(
			/* translators: %d: number of settlements loaded */
			_n(
				'Loaded %d settlement from Mollie.',
				'Loaded %d settlements from Mollie.',
				done,
				'fair-finance'
			),
			done
		);
	}

	if ( done === 0 ) {
		return skipped === 0
			? __( 'Mollie lists no settlements yet.', 'fair-finance' )
			: sprintf(
					/* translators: %d: number of settlements already saved */
					_n(
						'Nothing new: the %d settlement Mollie lists is already saved.',
						'Nothing new: all %d settlements Mollie lists are already saved.',
						skipped,
						'fair-finance'
					),
					skipped
				);
	}

	const loaded = sprintf(
		/* translators: %d: number of new settlements loaded */
		_n(
			'Loaded %d new settlement from Mollie.',
			'Loaded %d new settlements from Mollie.',
			done,
			'fair-finance'
		),
		done
	);

	if ( skipped === 0 ) {
		return loaded;
	}

	return sprintf(
		/* translators: 1: sentence saying how many settlements were loaded, 2: sentence saying how many were left unchanged */
		__( '%1$s %2$s', 'fair-finance' ),
		loaded,
		sprintf(
			/* translators: %d: number of settlements already saved */
			_n(
				'%d already saved was left unchanged.',
				'%d already saved were left unchanged.',
				skipped,
				'fair-finance'
			),
			skipped
		)
	);
};

/**
 * Loads settlements from Mollie in resumable batches.
 *
 * @param {Object}      props
 * @param {Object|null} props.connection What the Mollie connection allows.
 * @param {Object|null} props.openRun    Run that was open when the page loaded.
 * @param {Function}    props.onChanged  Called when saved settlements changed.
 * @return {JSX.Element} Panel.
 */
export default function MollieImportPanel( {
	connection,
	openRun,
	onChanged,
} ) {
	const { run, working, error, start, resume, refresh, adopt } =
		useSettlementImport( { onFinished: onChanged } );

	// Reopening the page picks up a run that was left unfinished.
	useEffect( () => {
		if ( openRun ) {
			adopt( openRun );
		}
	}, [ openRun, adopt ] );

	const canImport = connection?.can_import === true;
	// Every control below follows from the server's account of the run.
	const stopped = ! working && run?.resumable === true;
	const active = ! working && run?.status === 'running';
	const unfinished = stopped || active;
	const completed = ! working && run?.status === 'completed';
	const closed = ! working && run?.status === 'aborted';
	const startVariant = unfinished ? 'secondary' : 'primary';

	return (
		<Card className="fair-finance-settlements-import">
			<CardBody>
				<VStack spacing={ 3 }>
					<Text weight={ 600 } size={ 14 }>
						{ __( 'Load from Mollie', 'fair-finance' ) }
					</Text>
					<Text variant="muted">
						{ __(
							'“Load new” brings in the settlements of the connected organization that are not saved here yet, with their payments, captures, refunds and chargebacks. Settlements already loaded from Mollie are left unchanged. “Reload all” retrieves every settlement again, which takes longer and is only needed when saved data looks wrong.',
							'fair-finance'
						) }
					</Text>

					{ connection && ! canImport && (
						<Notice
							status="warning"
							isDismissible={ false }
							actions={ [
								{
									label: __(
										'Open Mollie connection settings',
										'fair-finance'
									),
									url: SETTINGS_URL,
									variant: 'link',
								},
							] }
						>
							{ connection.problem_message }{ ' ' }
							{ __(
								'Saved settlements and CSV import keep working.',
								'fair-finance'
							) }
						</Notice>
					) }

					{ error && (
						<Notice status="error" isDismissible={ false }>
							{ importErrorText( error ) }
						</Notice>
					) }

					{ working && run && (
						<HStack justify="flex-start" role="status">
							<Spinner />
							<Text>{ progressText( run ) }</Text>
						</HStack>
					) }

					{ stopped && (
						<Notice status="warning" isDismissible={ false }>
							<strong>{ unfinishedText( run ) }</strong>{ ' ' }
							{ run.error_message } { progressText( run ) }{ ' ' }
							{ __(
								'Continue it, or start another import instead. Settlements that were fully loaded stay saved either way.',
								'fair-finance'
							) }
						</Notice>
					) }

					{ active && (
						<Notice status="info" isDismissible={ false }>
							<strong>{ activeText( run ) }</strong>{ ' ' }
							{ progressText( run ) }{ ' ' }
							{ __(
								'It may be running in another window. Another import can be started once this one finishes, or after it has made no progress for five minutes.',
								'fair-finance'
							) }
						</Notice>
					) }

					{ closed && (
						<Notice status="error" isDismissible={ false }>
							{ run.error_message }
						</Notice>
					) }

					{ completed && (
						<Notice status="success" isDismissible={ false }>
							{ completedText( run ) }
						</Notice>
					) }

					<HStack justify="flex-start" wrap>
						{ unfinished && (
							<Button
								variant={ stopped ? 'primary' : 'secondary' }
								onClick={ resume }
								disabled={ ! canImport }
							>
								{ __( 'Continue import', 'fair-finance' ) }
							</Button>
						) }
						{ active && (
							<Button variant="primary" onClick={ refresh }>
								{ __( 'Refresh status', 'fair-finance' ) }
							</Button>
						) }
						<Button
							variant={ startVariant }
							onClick={ () => start( 'new' ) }
							disabled={ working || active || ! canImport }
							isBusy={ working && run?.kind === 'new' }
						>
							{ __( 'Load new', 'fair-finance' ) }
						</Button>
						<Button
							variant={
								unfinished || working ? 'secondary' : 'tertiary'
							}
							onClick={ () => start( 'history' ) }
							disabled={ working || active || ! canImport }
							isBusy={ working && run?.kind === 'history' }
						>
							{ __( 'Reload all', 'fair-finance' ) }
						</Button>
					</HStack>
				</VStack>
			</CardBody>
		</Card>
	);
}
