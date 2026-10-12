<?php
/**
 * Saved settlement rules
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Services;

use FairPaymentsConnector\Database\SettlementRepository;
use FairPaymentsConnector\Settlements\Movements;
use FairPaymentsConnector\Settlements\Report;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Decides how imported settlement data is saved (#1694).
 *
 * Provider facts only. Nothing here reads or writes transaction matches,
 * bank-entry links or allocations, so an import can never change a
 * reconciliation decision. Each import is kept as an immutable revision; a
 * settlement's stable ID and its revisions' content hashes let a later
 * reconciliation tell whether the facts it relied on have changed.
 */
class SettlementStore {

	/**
	 * MySQL named lock serializing every settlement write.
	 */
	const WRITE_LOCK = 'fair_payment_settlement_write';

	/**
	 * Most movements listed per group when describing a difference.
	 */
	const DIFF_LIMIT = 50;

	/**
	 * Repository.
	 *
	 * @var SettlementRepository
	 */
	private $repository;

	/**
	 * Constructor.
	 *
	 * @param SettlementRepository|null $repository Repository.
	 */
	public function __construct( ?SettlementRepository $repository = null ) {
		$this->repository = $repository ?? new SettlementRepository();
	}

	/**
	 * Run a write under the settlement lock, inside one transaction.
	 *
	 * @param callable $write The write; its return value is passed through.
	 * @return mixed|WP_Error
	 * @throws \Throwable When the write throws; the transaction is rolled back first.
	 */
	private function write( callable $write ) {
		if ( ! $this->repository->lock( self::WRITE_LOCK, 15 ) ) {
			return new WP_Error(
				'settlement_store_busy',
				__( 'Another settlement import is being saved. Try again in a moment.', 'fair-payments-connector' ),
				array( 'status' => 409 )
			);
		}

		$this->repository->begin();
		try {
			$result = $write();
			if ( is_wp_error( $result ) ) {
				$this->repository->rollback();
			} else {
				$this->repository->commit();
			}
			return $result;
		} catch ( \Throwable $e ) {
			$this->repository->rollback();
			throw $e;
		} finally {
			$this->repository->unlock( self::WRITE_LOCK );
		}
	}

	/*
	 * Accounts.
	 */

	/**
	 * The account of the Mollie organization this site is connected to,
	 * created on first use. Mollie reported the organization, so it is
	 * verified.
	 *
	 * @param string $organization_id Mollie organization ID.
	 * @return array|WP_Error Account row.
	 */
	public function ensure_connected_account( $organization_id ) {
		return $this->write(
			function () use ( $organization_id ) {
				$account = $this->repository->find_account_by_organization( $organization_id );
				if ( $account ) {
					return $account;
				}

				$id = $this->repository->insert_account(
					array(
						/* translators: %s: Mollie organization ID */
						'label'           => sprintf( __( 'Mollie %s', 'fair-payments-connector' ), $organization_id ),
						'organization_id' => $organization_id,
						'verified'        => true,
					)
				);

				return $id ? $this->repository->get_account( $id ) : self::save_failed();
			}
		);
	}

	/**
	 * Confirm that an account named during a CSV upload is the connected
	 * Mollie organization, so its settlements converge with API imports.
	 *
	 * @param int    $account_id      Unverified account.
	 * @param string $organization_id Connected Mollie organization ID.
	 * @return array|WP_Error The verified account now holding its settlements.
	 */
	public function confirm_account( $account_id, $organization_id ) {
		return $this->write(
			function () use ( $account_id, $organization_id ) {
				$account = $this->repository->get_account( $account_id );
				if ( ! $account ) {
					return new WP_Error( 'settlement_account_not_found', __( 'Account not found.', 'fair-payments-connector' ), array( 'status' => 404 ) );
				}
				if ( (int) $account['verified'] ) {
					return new WP_Error( 'settlement_account_verified', __( 'This account is already confirmed.', 'fair-payments-connector' ), array( 'status' => 409 ) );
				}

				$target = $this->repository->find_account_by_organization( $organization_id );
				if ( ! $target ) {
					$this->repository->update_account(
						$account_id,
						array(
							'organization_id' => $organization_id,
							'verified'        => 1,
						)
					);
					return $this->repository->get_account( $account_id );
				}

				foreach ( $this->repository->get_settlements_of_account( $account_id ) as $settlement ) {
					$matches = null === $settlement['reference']
						? array()
						: $this->repository->find_settlements_by_reference( (int) $target['id'], $settlement['reference'] );

					if ( 1 !== count( $matches ) ) {
						// No counterpart, or more than one: keep it as its own record.
						$this->repository->update_settlement( (int) $settlement['id'], array( 'account_id' => (int) $target['id'] ) );
						$this->recompute( (int) $settlement['id'] );
						foreach ( $matches as $match ) {
							$this->recompute( (int) $match['id'] );
						}
						continue;
					}

					$this->fold_into( $settlement, $matches[0] );
				}

				$this->repository->delete_account( $account_id );

				return $this->repository->get_account( (int) $target['id'] );
			}
		);
	}

	/**
	 * Fold a CSV-only settlement into the settlement it is the same payout as.
	 *
	 * @param array $from Settlement being folded in.
	 * @param array $into Settlement that stays.
	 * @return void
	 */
	private function fold_into( array $from, array $into ) {
		$this->repository->move_revisions( (int) $from['id'], (int) $into['id'] );

		if ( $from['csv_revision_id'] ) {
			if ( ! $into['csv_revision_id'] ) {
				$this->repository->update_settlement(
					(int) $into['id'],
					array(
						'csv_revision_id'    => (int) $from['csv_revision_id'],
						'last_csv_import_at' => $from['last_csv_import_at'],
					)
				);
			} else {
				$accepted = $this->repository->get_revision( (int) $into['csv_revision_id'] );
				$incoming = $this->repository->get_revision( (int) $from['csv_revision_id'] );
				$same     = $accepted && $incoming && $accepted['content_hash'] === $incoming['content_hash'];
				$this->repository->update_revision( (int) $from['csv_revision_id'], array( 'status' => $same ? 'superseded' : 'conflict' ) );
			}
		}

		$this->repository->delete_settlement( (int) $from['id'] );
		$this->recompute( (int) $into['id'] );
	}

	/*
	 * API imports.
	 */

	/**
	 * Find or create the settlement an API response describes.
	 *
	 * A settlement first saved from a CSV in the same account is adopted
	 * when its payout reference identifies exactly one record, so both
	 * sources converge on one settlement.
	 *
	 * @param array $account Account row.
	 * @param array $facts   Settlement facts from the provider.
	 * @return int|WP_Error Settlement ID.
	 */
	public function upsert_api_settlement( array $account, array $facts ) {
		return $this->write(
			function () use ( $account, $facts ) {
				$account_id = (int) $account['id'];
				$header     = self::header_from_facts( $facts );
				$existing   = $this->repository->find_settlement_by_provider_id( $account_id, $facts['provider_id'] );

				if ( $existing ) {
					// Published facts change only when a full revision is published.
					if ( ! $existing['api_revision_id'] ) {
						$this->repository->update_settlement( (int) $existing['id'], $header );
						$this->recompute( (int) $existing['id'] );
					}
					return (int) $existing['id'];
				}

				if ( null !== $facts['reference'] ) {
					$unclaimed = array();
					foreach ( $this->repository->find_settlements_by_reference( $account_id, $facts['reference'] ) as $candidate ) {
						if ( null === $candidate['provider_id'] ) {
							$unclaimed[] = $candidate;
						}
					}

					if ( 1 === count( $unclaimed ) ) {
						$this->repository->update_settlement( (int) $unclaimed[0]['id'], $header );
						$this->recompute( (int) $unclaimed[0]['id'] );
						return (int) $unclaimed[0]['id'];
					}
				}

				$header['account_id']   = $account_id;
				$header['completeness'] = 'incomplete';
				$id                     = $this->repository->insert_settlement( $header );

				return $id ? $id : self::save_failed();
			}
		);
	}

	/**
	 * Stage a new API revision of a settlement for an import run.
	 *
	 * @param int     $settlement_id Settlement ID.
	 * @param int     $run_id        Import run ID.
	 * @param array   $facts         Settlement facts from the provider.
	 * @param array[] $aggregates    Aggregate rows from the report summary.
	 * @param string  $summary_check Result of checking the summary against the payout.
	 * @return int|WP_Error Revision ID.
	 */
	public function stage_api_revision( $settlement_id, $run_id, array $facts, array $aggregates, $summary_check ) {
		// A retried step must not leave a second staged copy behind.
		foreach ( $this->repository->find_staged_revisions_of_run( $run_id ) as $stale ) {
			if ( (int) $stale['settlement_id'] === (int) $settlement_id ) {
				$this->repository->delete_staged_revision( (int) $stale['id'] );
			}
		}

		$revision_id = $this->repository->insert_revision(
			array(
				'settlement_id'  => (int) $settlement_id,
				'source'         => Movements::SOURCE_API,
				'status'         => 'staged',
				'run_id'         => (int) $run_id,
				'facts'          => wp_json_encode( $facts ),
				'coverage'       => wp_json_encode( array( 'summary_check' => $summary_check ) ),
				'report_version' => Report::VERSION,
			)
		);

		if ( ! $revision_id ) {
			return self::save_failed();
		}

		$this->repository->save_items( $revision_id, $aggregates );

		return $revision_id;
	}

	/**
	 * Publish a fully retrieved API revision in one step.
	 *
	 * The settlement keeps showing its previous revision until this commits.
	 * A revision staged before a newer one was published is set aside
	 * instead of replacing it.
	 *
	 * @param int $revision_id Staged revision.
	 * @return string|WP_Error `published`, `unchanged`, or `superseded`.
	 */
	public function publish_api_revision( $revision_id ) {
		return $this->write(
			function () use ( $revision_id ) {
				$revision = $this->repository->get_revision( $revision_id );
				if ( ! $revision || 'staged' !== $revision['status'] ) {
					return 'superseded';
				}

				$settlement = $this->repository->get_settlement( (int) $revision['settlement_id'], true );
				if ( ! $settlement ) {
					return self::save_failed();
				}

				if ( $settlement['api_revision_id'] && (int) $settlement['api_revision_id'] > (int) $revision_id ) {
					$this->repository->update_revision( $revision_id, array( 'status' => 'superseded' ) );
					return 'superseded';
				}

				$facts    = (array) json_decode( (string) $revision['facts'], true );
				$staged   = (array) json_decode( (string) $revision['coverage'], true );
				$items    = $this->repository->get_items( $revision_id );
				$hash     = Movements::content_hash( $facts, $items );
				$now      = current_time( 'mysql', true );
				$previous = $settlement['api_revision_id'] ? $this->repository->get_revision( (int) $settlement['api_revision_id'] ) : null;
				$header   = self::header_from_facts( $facts );
				$outcome  = 'published';

				$header['last_refreshed_at'] = $now;
				$header['last_failure_code'] = null;
				$header['last_failure_at']   = null;

				// A revision saved before report details were kept cannot hash
				// like one that has them. Gaining those details is not Mollie
				// changing its mind, so only the payout facts and the detail
				// movements decide whether the source changed.
				$upgrade = $previous && null === $previous['report_version'];
				$changed = $previous && $previous['content_hash'] !== $hash;
				if ( $upgrade ) {
					$before  = self::detail_hash( (array) json_decode( (string) $previous['facts'], true ), $this->repository->get_items( (int) $previous['id'] ) );
					$changed = self::detail_hash( $facts, $items ) !== $before;
				}

				if ( $previous && ! $upgrade && ! $changed ) {
					// Same facts as before: keep the revision already published.
					$this->repository->delete_staged_revision( $revision_id );
					$outcome = 'unchanged';
				} else {
					$counts = array();
					foreach ( $items as $item ) {
						if ( ! $item['is_aggregate'] ) {
							$counts[ $item['type'] ] = ( $counts[ $item['type'] ] ?? 0 ) + 1;
						}
					}

					$this->repository->update_revision(
						$revision_id,
						array(
							'status'       => 'published',
							'content_hash' => $hash,
							'totals'       => wp_json_encode( Movements::totals( $items ) ),
							'coverage'     => wp_json_encode(
								array(
									'summary_check' => (string) ( $staged['summary_check'] ?? 'unavailable' ),
									'retrieved'     => array(
										'payments'    => (int) ( $counts[ Movements::TYPE_PAYMENT ] ?? 0 ),
										'captures'    => (int) ( $counts[ Movements::TYPE_CAPTURE ] ?? 0 ),
										'refunds'     => (int) ( $counts[ Movements::TYPE_REFUND ] ?? 0 ),
										'chargebacks' => (int) ( $counts[ Movements::TYPE_CHARGEBACK ] ?? 0 ),
									),
								)
							),
							'item_count'   => count( $items ),
							'published_at' => $now,
						)
					);

					if ( $previous ) {
						$this->repository->update_revision( (int) $previous['id'], array( 'status' => 'superseded' ) );
						if ( $changed ) {
							$header['material_change_at'] = $now;
						}
					}
					$header['api_revision_id'] = (int) $revision_id;
				}

				$this->repository->update_settlement( (int) $settlement['id'], $header );

				if ( ! empty( $facts['balance_id'] ) ) {
					$account = $this->repository->get_account( (int) $settlement['account_id'] );
					if ( $account && null === $account['balance_id'] ) {
						$this->repository->update_account( (int) $account['id'], array( 'balance_id' => $facts['balance_id'] ) );
					}
				}

				$this->recompute( (int) $settlement['id'] );

				return $outcome;
			}
		);
	}

	/**
	 * Hash of a settlement's payout facts and detail movements only, leaving
	 * the report lines out.
	 *
	 * @param array   $facts Settlement facts.
	 * @param array[] $items Movements of a revision.
	 * @return string
	 */
	private static function detail_hash( array $facts, array $items ) {
		return Movements::content_hash(
			$facts,
			array_filter(
				$items,
				static function ( $item ) {
					return ! $item['is_aggregate'];
				}
			)
		);
	}

	/**
	 * Record that loading a settlement from Mollie failed, apart from its data.
	 *
	 * @param int    $settlement_id Settlement ID.
	 * @param string $code          Safe failure category.
	 * @return void
	 */
	public function record_failure( $settlement_id, $code ) {
		$this->repository->update_settlement(
			(int) $settlement_id,
			array(
				'last_failure_code' => (string) $code,
				'last_failure_at'   => current_time( 'mysql', true ),
			)
		);
	}

	/**
	 * Settlement columns taken from provider facts.
	 *
	 * @param array $facts Settlement facts.
	 * @return array
	 */
	private static function header_from_facts( array $facts ) {
		return array(
			'provider_id'         => $facts['provider_id'],
			'reference'           => $facts['reference'],
			'currency'            => $facts['currency'],
			'amount'              => $facts['amount'],
			'status'              => $facts['status'],
			'provider_created_at' => $facts['created_at'],
			'settled_at'          => $facts['settled_at'],
			'invoice_id'          => $facts['invoice_id'],
			'balance_id'          => $facts['balance_id'],
		);
	}

	/*
	 * CSV imports.
	 */

	/**
	 * Work out what importing a parsed CSV into an account does, and do it
	 * when asked to commit.
	 *
	 * Outcomes: `new` (a settlement is created), `attach` (it joins the
	 * settlement already saved from Mollie), `duplicate` (the same content
	 * is already saved; nothing changes), `conflict` (a different file was
	 * already accepted for this settlement; the accepted data stays and the
	 * differences are kept for review), `ambiguous` (more than one saved
	 * settlement carries this reference; nothing is saved).
	 *
	 * @param array      $parsed  Result of CsvParser::parse().
	 * @param array|null $account Existing account row, or null for a new local account.
	 * @param string     $label   Label for a new local account.
	 * @param bool       $commit  Save the result.
	 * @return array|WP_Error `array( 'outcome' => string, 'settlement_id' => int|null )`.
	 */
	public function import_csv( array $parsed, $account, $label, $commit ) {
		$plan = function ( $account ) use ( $parsed ) {
			if ( ! $account ) {
				return array( 'new', null );
			}

			$candidates = $this->repository->find_settlements_by_reference( (int) $account['id'], $parsed['facts']['reference'] );
			if ( count( $candidates ) > 1 ) {
				return array( 'ambiguous', null );
			}
			if ( empty( $candidates ) ) {
				return array( 'new', null );
			}

			$settlement = $candidates[0];
			if ( ! $settlement['csv_revision_id'] ) {
				return array( 'attach', $settlement );
			}

			$accepted = $this->repository->get_revision( (int) $settlement['csv_revision_id'] );

			return array( $accepted && $accepted['content_hash'] === $parsed['hash'] ? 'duplicate' : 'conflict', $settlement );
		};

		if ( ! $account && '' !== (string) $label ) {
			// Reuse a local account of the same name rather than piling up twins.
			$account = $this->repository->find_local_account_by_label( $label );
		}

		if ( ! $commit ) {
			list( $outcome, $settlement ) = $plan( $account );
			return array(
				'outcome'       => $outcome,
				'settlement_id' => $settlement ? (int) $settlement['id'] : null,
			);
		}

		return $this->write(
			function () use ( $parsed, $account, $label, $plan ) {
				if ( ! $account ) {
					$account_id = $this->repository->insert_account(
						array(
							'label'    => $label,
							'verified' => false,
						)
					);
					$account    = $account_id ? $this->repository->get_account( $account_id ) : null;
					if ( ! $account ) {
						return self::save_failed();
					}
				}

				list( $outcome, $settlement ) = $plan( $account );
				$now                          = current_time( 'mysql', true );

				if ( 'ambiguous' === $outcome ) {
					return new WP_Error(
						'settlement_identity_ambiguous',
						__( 'More than one saved settlement in this account has this reference, so the file cannot be attached to one of them. Nothing was imported.', 'fair-payments-connector' ),
						array( 'status' => 409 )
					);
				}

				if ( 'duplicate' === $outcome ) {
					return array(
						'outcome'       => $outcome,
						'settlement_id' => (int) $settlement['id'],
					);
				}

				if ( 'conflict' === $outcome ) {
					foreach ( $this->repository->find_revisions( (int) $settlement['id'], Movements::SOURCE_CSV, 'conflict' ) as $proposed ) {
						if ( $proposed['content_hash'] === $parsed['hash'] ) {
							return array(
								'outcome'       => $outcome,
								'settlement_id' => (int) $settlement['id'],
							);
						}
					}
				}

				if ( 'new' === $outcome ) {
					$settlement_id = $this->repository->insert_settlement(
						array(
							'account_id'   => (int) $account['id'],
							'reference'    => $parsed['facts']['reference'],
							'currency'     => $parsed['facts']['currency'],
							'completeness' => 'unverified',
						)
					);
					if ( ! $settlement_id ) {
						return self::save_failed();
					}
				} else {
					$settlement_id = (int) $settlement['id'];
				}

				$revision_id = $this->repository->insert_revision(
					array(
						'settlement_id' => $settlement_id,
						'source'        => Movements::SOURCE_CSV,
						'status'        => 'conflict' === $outcome ? 'conflict' : 'published',
						'content_hash'  => $parsed['hash'],
						'facts'         => wp_json_encode( $parsed['facts'] ),
						'coverage'      => wp_json_encode( array( 'format' => $parsed['format'] ) ),
						'totals'        => wp_json_encode( $parsed['totals'] ),
						'item_count'    => count( $parsed['movements'] ),
						'published_at'  => 'conflict' === $outcome ? null : $now,
					)
				);
				if ( ! $revision_id ) {
					return self::save_failed();
				}
				$this->repository->save_items( $revision_id, $parsed['movements'] );

				if ( 'conflict' !== $outcome ) {
					$update = array(
						'csv_revision_id'    => $revision_id,
						'last_csv_import_at' => $now,
					);
					if ( $settlement && null === $settlement['currency'] ) {
						$update['currency'] = $parsed['facts']['currency'];
					}
					$this->repository->update_settlement( $settlement_id, $update );
				}

				$this->recompute( $settlement_id );

				return array(
					'outcome'       => $outcome,
					'settlement_id' => $settlement_id,
				);
			}
		);
	}

	/*
	 * Review state.
	 */

	/**
	 * Recalculate a settlement's completeness and the differences that need
	 * an administrator's attention.
	 *
	 * @param int $settlement_id Settlement ID.
	 * @return void
	 */
	public function recompute( $settlement_id ) {
		$settlement = $this->repository->get_settlement( $settlement_id );
		if ( ! $settlement ) {
			return;
		}

		$api           = $settlement['api_revision_id'] ? $this->repository->get_revision( (int) $settlement['api_revision_id'] ) : null;
		$csv           = $settlement['csv_revision_id'] ? $this->repository->get_revision( (int) $settlement['csv_revision_id'] ) : null;
		$api_items     = $api ? $this->repository->get_items( (int) $api['id'] ) : array();
		$csv_items     = $csv ? $this->repository->get_items( (int) $csv['id'] ) : array();
		$coverage      = $api ? (array) json_decode( (string) $api['coverage'], true ) : array();
		$summary_check = (string) ( $coverage['summary_check'] ?? 'unavailable' );
		$discrepancies = array();

		if ( 'mismatch' === $summary_check ) {
			$summary         = Report::summarize( $settlement['amount'], $settlement['currency'], $api_items );
			$discrepancies[] = array(
				'code'       => 'summary_total_mismatch',
				// Exact, so a difference below one cent is not rounded away.
				'difference' => $summary['difference'] ?? null,
				'currency'   => $summary['currency'] ?? null,
			);
		}

		if ( $api && $csv ) {
			$csv_facts = (array) json_decode( (string) $csv['facts'], true );
			if ( ! empty( $csv_facts['currency'] ) && null !== $settlement['currency'] && $csv_facts['currency'] !== $settlement['currency'] ) {
				$discrepancies[] = array(
					'code' => 'currency_conflict',
					'api'  => $settlement['currency'],
					'csv'  => $csv_facts['currency'],
				);
			}

			$only = array(
				Movements::SOURCE_API => array(),
				Movements::SOURCE_CSV => array(),
			);
			foreach ( Movements::merge( $api_items, $csv_items ) as $movement ) {
				if ( null !== $movement['conflict'] ) {
					$discrepancies[] = array(
						'code'        => 'value_conflict',
						'type'        => $movement['type'],
						'external_id' => $movement['external_id'],
						'fields'      => $movement['conflict'],
					);
				} elseif ( 1 === count( $movement['sources'] ) && Movements::has_established_identity( $movement ) ) {
					$only[ $movement['sources'][0] ][] = $movement['external_id'];
				}
			}
			foreach ( $only as $source => $ids ) {
				if ( ! empty( $ids ) ) {
					$discrepancies[] = array(
						'code'         => 'only_in_' . $source,
						'count'        => count( $ids ),
						'external_ids' => array_slice( $ids, 0, self::DIFF_LIMIT ),
					);
				}
			}
		}

		$review = 0;
		foreach ( array_merge( $api_items, $csv_items ) as $movement ) {
			$review += $movement['needs_review'] ? 1 : 0;
		}
		if ( $review > 0 ) {
			$discrepancies[] = array(
				'code'  => 'needs_review',
				'count' => $review,
			);
		}

		foreach ( $this->repository->find_revisions( $settlement_id, Movements::SOURCE_CSV, 'conflict' ) as $proposed ) {
			$discrepancies[] = array(
				'code'        => 'csv_content_conflict',
				'revision_id' => (int) $proposed['id'],
			);
		}

		if ( null !== $settlement['reference'] && count( $this->repository->find_settlements_by_reference( (int) $settlement['account_id'], $settlement['reference'] ) ) > 1 ) {
			$discrepancies[] = array( 'code' => 'ambiguous_identity' );
		}

		if ( $settlement['material_change_at'] ) {
			$discrepancies[] = array(
				'code' => 'source_changed',
				'at'   => $settlement['material_change_at'],
			);
		}

		// Finishing every page is not the same as the money adding up: only a
		// report summary that equals the payout is called verified.
		if ( ( ! $api && ! $csv ) || ( null !== $settlement['provider_id'] && ! $api ) ) {
			$completeness = 'incomplete';
		} elseif ( $api && 'verified' === $summary_check ) {
			$completeness = 'verified';
		} else {
			$completeness = 'unverified';
		}

		$this->repository->update_settlement(
			$settlement_id,
			array(
				'completeness'      => $completeness,
				'discrepancies'     => wp_json_encode( $discrepancies ),
				'discrepancy_count' => count( $discrepancies ),
			)
		);
	}

	/**
	 * Error for a row that could not be written.
	 *
	 * @return WP_Error
	 */
	private static function save_failed() {
		return new WP_Error(
			'settlement_not_saved',
			__( 'The settlement could not be saved. Nothing was changed.', 'fair-payments-connector' ),
			array( 'status' => 500 )
		);
	}
}
