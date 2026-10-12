<?php
/**
 * Mollie settlement provider adapter
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Payment;

use Mollie\Api\MollieApiClient;
use Mollie\Api\Exceptions\ApiException;
use Mollie\Api\Http\Requests\GetPaginatedSettlementCapturesRequest;
use Mollie\Api\Http\Requests\GetPaginatedSettlementChargebacksRequest;
use Mollie\Api\Http\Requests\GetPaginatedSettlementPaymentsRequest;
use Mollie\Api\Http\Requests\GetPaginatedSettlementRefundsRequest;
use FairPaymentsConnector\Settlements\Decimal;
use FairPaymentsConnector\Settlements\Movements;
use FairPaymentsConnector\Settlements\Report;

defined( 'WPINC' ) || die;

/**
 * Reads settlements and their contents from Mollie, one bounded page per
 * call, and returns them in the local settlement model.
 *
 * Every method issues exactly one Mollie request, so an import can be
 * checkpointed between any two of them.
 */
class MollieSettlementProvider {

	/**
	 * Settlement contents Mollie lists separately, in import order.
	 */
	const PARTS = array( 'payments', 'captures', 'refunds', 'chargebacks' );

	/**
	 * Mollie API client instance
	 *
	 * @var MollieApiClient
	 */
	private $mollie;

	/**
	 * Constructor
	 *
	 * @param MollieApiClient|null $client Optional pre-authenticated client (for tests).
	 *                                     When omitted, the connection's client is used
	 *                                     exactly as MolliePaymentHandler builds it.
	 * @throws SettlementProviderException When Mollie is not connected.
	 */
	public function __construct( ?MollieApiClient $client = null ) {
		if ( null !== $client ) {
			$this->mollie = $client;
			return;
		}

		try {
			$this->mollie = ( new MolliePaymentHandler() )->client();
		} catch ( \Exception $e ) {
			throw new SettlementProviderException( SettlementProviderException::NOT_CONNECTED ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- safe category constant.
		}
	}

	/**
	 * One page of settlements, newest first.
	 *
	 * @param string|null $from  Cursor from a previous page.
	 * @param int         $limit Page size.
	 * @return array{settlements: array[], next: string|null} Settlement facts and the next cursor.
	 * @throws SettlementProviderException When Mollie cannot return the page.
	 */
	public function list_settlements( $from, $limit ) {
		$page = $this->request(
			function () use ( $from, $limit ) {
				return $this->mollie->settlements->page( $from ? $from : null, $limit );
			}
		);

		$settlements = array();
		foreach ( $page as $settlement ) {
			$settlements[] = self::settlement_facts( $settlement );
		}

		$next = self::next_cursor( $page );
		if ( null !== $next && $next === $from ) {
			// A cursor that does not move would repeat this page forever.
			throw new SettlementProviderException( SettlementProviderException::INVALID_RESPONSE ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- safe category constant.
		}

		return array(
			'settlements' => $settlements,
			'next'        => $next,
		);
	}

	/**
	 * One settlement with its report summary.
	 *
	 * @param string $settlement_id Mollie settlement ID.
	 * @return array{facts: array, aggregates: array[], summary_check: string}
	 * @throws SettlementProviderException When Mollie cannot return the settlement.
	 */
	public function get_settlement( $settlement_id ) {
		$settlement = $this->request(
			function () use ( $settlement_id ) {
				return $this->mollie->settlements->get( $settlement_id );
			}
		);

		$facts = self::settlement_facts( $settlement );
		if ( $facts['provider_id'] !== $settlement_id ) {
			throw new SettlementProviderException( SettlementProviderException::INVALID_RESPONSE ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- safe category constant.
		}

		$aggregates = self::period_aggregates( $settlement->periods ?? null, $facts['currency'] );

		return array(
			'facts'         => $facts,
			'aggregates'    => $aggregates,
			'summary_check' => self::summary_check( $facts, $aggregates ),
		);
	}

	/**
	 * One page of a settlement's payments, captures, refunds or chargebacks.
	 *
	 * @param string      $settlement_id Mollie settlement ID.
	 * @param string      $part          One of PARTS.
	 * @param string|null $from          Cursor from a previous page.
	 * @param int         $limit         Page size.
	 * @return array{movements: array[], next: string|null}
	 * @throws SettlementProviderException When Mollie cannot return the page.
	 */
	public function list_movements( $settlement_id, $part, $from, $limit ) {
		$requests = array(
			'payments'    => GetPaginatedSettlementPaymentsRequest::class,
			'captures'    => GetPaginatedSettlementCapturesRequest::class,
			'refunds'     => GetPaginatedSettlementRefundsRequest::class,
			'chargebacks' => GetPaginatedSettlementChargebacksRequest::class,
		);
		$types    = array(
			'payments'    => Movements::TYPE_PAYMENT,
			'captures'    => Movements::TYPE_CAPTURE,
			'refunds'     => Movements::TYPE_REFUND,
			'chargebacks' => Movements::TYPE_CHARGEBACK,
		);

		if ( ! isset( $requests[ $part ] ) ) {
			throw new SettlementProviderException( SettlementProviderException::INVALID_RESPONSE ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- safe category constant.
		}

		// The requests are built directly: the SDK's settlementPayments
		// helper (v3.13) drops `from` and `limit`, which would return the
		// first page forever.
		$request = new $requests[ $part ]( $settlement_id, $from ? $from : null, $limit );
		$page    = $this->request(
			function () use ( $request ) {
				return $this->mollie->send( $request );
			}
		);

		$movements = array();
		foreach ( $page as $item ) {
			$movements[] = self::movement( $types[ $part ], $item );
		}

		$next = self::next_cursor( $page );
		if ( null !== $next && $next === $from ) {
			// A cursor that does not move would repeat this page forever.
			throw new SettlementProviderException( SettlementProviderException::INVALID_RESPONSE ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- safe category constant.
		}

		return array(
			'movements' => $movements,
			'next'      => $next,
		);
	}

	/**
	 * Run one Mollie request, reducing any failure to a safe category.
	 *
	 * @param callable $call The SDK call.
	 * @return mixed
	 * @throws SettlementProviderException When the request fails.
	 */
	private function request( callable $call ) {
		try {
			return $call();
		} catch ( ApiException $e ) {
			$category = in_array( (int) $e->getCode(), array( 401, 403 ), true )
				? SettlementProviderException::ACCESS_DENIED
				: SettlementProviderException::REQUEST_FAILED;
			throw new SettlementProviderException( $category ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- safe category constant.
		} catch ( \Throwable $e ) {
			throw new SettlementProviderException( SettlementProviderException::REQUEST_FAILED ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- safe category constant.
		}
	}

	/**
	 * Cursor of the page after this one, as Mollie states it.
	 *
	 * @param object $page SDK collection.
	 * @return string|null
	 */
	private static function next_cursor( $page ) {
		$href = $page->_links->next->href ?? null;
		if ( ! is_string( $href ) || '' === $href ) {
			return null;
		}

		parse_str( (string) wp_parse_url( $href, PHP_URL_QUERY ), $query );
		$from = $query['from'] ?? null;

		return is_string( $from ) && 1 === preg_match( '/^[A-Za-z0-9_]{1,64}$/', $from ) ? $from : null;
	}

	/**
	 * Settlement facts from a Mollie settlement resource.
	 *
	 * @param object $settlement Mollie settlement.
	 * @return array
	 * @throws SettlementProviderException When the settlement has no usable identity.
	 */
	private static function settlement_facts( $settlement ) {
		$id = $settlement->id ?? null;
		if ( ! is_string( $id ) || 1 !== preg_match( '/^[A-Za-z0-9_]{1,64}$/', $id ) ) {
			throw new SettlementProviderException( SettlementProviderException::INVALID_RESPONSE ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- safe category constant.
		}

		$money     = self::money( $settlement->amount ?? null );
		$reference = $settlement->reference ?? null;

		return array(
			'provider_id' => $id,
			'reference'   => is_string( $reference ) && '' !== $reference ? substr( $reference, 0, 64 ) : null,
			'currency'    => $money['currency'],
			'amount'      => $money['value'],
			'status'      => self::text( $settlement->status ?? null, 20 ),
			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API field.
			'created_at'  => self::datetime( $settlement->createdAt ?? null ),
			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API field.
			'settled_at'  => self::datetime( $settlement->settledAt ?? null ),
			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API field.
			'invoice_id'  => self::text( $settlement->invoiceId ?? null, 64 ),
			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API field.
			'balance_id'  => self::text( $settlement->balanceId ?? null, 64 ),
		);
	}

	/**
	 * A movement from a Mollie payment, capture, refund or chargeback.
	 *
	 * @param string $type     Movement type.
	 * @param object $item Mollie resource.
	 * @return array
	 * @throws SettlementProviderException When the resource has no usable identity.
	 */
	private static function movement( $type, $item ) {
		$id = $item->id ?? null;
		if ( ! is_string( $id ) || 1 !== preg_match( '/^[A-Za-z0-9_]{1,64}$/', $id ) ) {
			throw new SettlementProviderException( SettlementProviderException::INVALID_RESPONSE ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- safe category constant.
		}

		$amount = self::money( $item->amount ?? null );
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API field.
		$settled = self::money( $item->settlementAmount ?? null );
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API field.
		$payment = Movements::TYPE_PAYMENT === $type ? $id : self::text( $item->paymentId ?? null, 64 );
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API field.
		$when = $item->paidAt ?? ( $item->createdAt ?? null );

		$movement = Movements::make(
			array(
				'type'                => $type,
				'external_id'         => $id,
				'payment_reference'   => $payment,
				'amount'              => $amount['value'],
				'currency'            => $amount['currency'],
				'settlement_amount'   => $settled['value'],
				'settlement_currency' => $settled['currency'],
				'description'         => (string) self::text( $item->description ?? null, 255 ),
				'provider_status'     => self::text( $item->status ?? null, 32 ),
				'occurred_at'         => self::datetime( $when ),
				// A value Mollie sent that could not be read exactly stays unknown.
				'needs_review'        => $amount['invalid'] || $settled['invalid'],
				'raw_type'            => self::text( $item->method ?? null, 64 ),
			)
		);

		$movement['identity_key'] = Movements::identity_base( $movement ) . '#1';

		return $movement;
	}

	/**
	 * Aggregate rows from a settlement's per-period report.
	 *
	 * Each revenue and cost line keeps its report details exactly as Mollie
	 * supplied them. Both describe money that the detail movements may also
	 * describe, so they are stored apart and never added to them.
	 *
	 * @param mixed       $periods  Mollie `periods` object.
	 * @param string|null $currency Settlement currency.
	 * @return array[]
	 */
	private static function period_aggregates( $periods, $currency ) {
		$aggregates = array();
		if ( ! is_object( $periods ) && ! is_array( $periods ) ) {
			return $aggregates;
		}

		foreach ( (array) $periods as $year => $months ) {
			foreach ( (array) $months as $month => $period ) {
				$period = (array) $period;
				$groups = array(
					Report::GROUP_REVENUE => Movements::TYPE_SUMMARY,
					Report::GROUP_COSTS   => Movements::TYPE_FEE,
				);

				foreach ( $groups as $group => $type ) {
					foreach ( (array) ( $period[ $group ] ?? array() ) as $line ) {
						$line = (array) $line;
						if ( isset( $line['rate'] ) ) {
							$line['rate'] = (array) $line['rate'];
						}

						$report       = Report::line( $year, $month, $group, $line, $period );
						$contribution = Report::contribution( $report );

						$aggregates[] = Movements::make(
							array(
								'type'                => $type,
								'is_aggregate'        => true,
								// Signed payout contribution: costs reduce the payout.
								'settlement_amount'   => $contribution['value'],
								'settlement_currency' => null === $contribution['value'] ? null : ( $contribution['currency'] ?? $currency ),
								'description'         => (string) self::text( $line['description'] ?? null, 255 ),
								// A value Mollie sent that could not be read exactly is flagged.
								'needs_review'        => Report::has_invalid_value( $report ),
								'raw_type'            => substr( sprintf( '%s-%s|%s', $year, $month, (string) $report['method'] ), 0, 64 ),
								'report'              => $report,
							)
						);
					}
				}
			}
		}

		return Movements::assign_identities( $aggregates );
	}

	/**
	 * Whether the report adds up to the payout, compared exactly.
	 *
	 * @param array   $facts      Settlement facts.
	 * @param array[] $aggregates Aggregate rows from the report.
	 * @return string `verified`, `mismatch`, or `unavailable` when it cannot be checked.
	 */
	private static function summary_check( array $facts, array $aggregates ) {
		$summary = Report::summarize( $facts['amount'], $facts['currency'], $aggregates );

		return null === $summary || null === $facts['currency'] ? 'unavailable' : $summary['check'];
	}

	/**
	 * Read a Mollie amount object exactly.
	 *
	 * @param mixed $amount Mollie `{ value, currency }` object.
	 * @return array{value: string|null, currency: string|null, invalid: bool}
	 */
	private static function money( $amount ) {
		$unknown = array(
			'value'    => null,
			'currency' => null,
			'invalid'  => false,
		);
		if ( null === $amount ) {
			return $unknown;
		}

		$amount   = (object) (array) $amount;
		$currency = $amount->currency ?? null;
		$value    = Decimal::is_currency( $currency ) ? Decimal::normalize( $amount->value ?? null, $currency ) : null;

		if ( null === $value ) {
			$unknown['invalid'] = true;
			return $unknown;
		}

		return array(
			'value'    => $value,
			'currency' => $currency,
			'invalid'  => false,
		);
	}

	/**
	 * Read an optional short text value.
	 *
	 * @param mixed $value  Raw value.
	 * @param int   $length Maximum length.
	 * @return string|null
	 */
	private static function text( $value, $length ) {
		if ( ! is_string( $value ) || '' === $value ) {
			return null;
		}

		return substr( sanitize_text_field( $value ), 0, $length );
	}

	/**
	 * Read an ISO 8601 timestamp as a UTC datetime.
	 *
	 * @param mixed $value Raw value.
	 * @return string|null `Y-m-d H:i:s` in UTC.
	 */
	private static function datetime( $value ) {
		if ( ! is_string( $value ) || '' === $value ) {
			return null;
		}

		$timestamp = strtotime( $value );

		return false === $timestamp ? null : gmdate( 'Y-m-d H:i:s', $timestamp );
	}
}
