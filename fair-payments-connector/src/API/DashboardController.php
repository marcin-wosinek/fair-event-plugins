<?php
/**
 * REST API Controller for the admin dashboard
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery -- aggregation queries on a custom table; caching not applicable for real-time summaries.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairEventsShared\Money;
use FairPaymentsConnector\Database\Schema;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Provides read-only summary stats for the admin dashboard.
 */
class DashboardController extends WP_REST_Controller {

	/**
	 * Selected month format (YYYY-MM).
	 */
	private const MONTH_PATTERN = '/^(\d{4})-(0[1-9]|1[0-2])$/';

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Register the dashboard routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/dashboard/monthly-summary',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_monthly_summary' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'month' => array(
							'description'       => __( 'Month to summarize, as YYYY-MM. Defaults to the current month.', 'fair-payments-connector' ),
							'type'              => 'string',
							'validate_callback' => array( $this, 'validate_month' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);
	}

	/**
	 * Require manage_options capability.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool
	 */
	public function get_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Accept only a YYYY-MM month from year 2000 onwards.
	 *
	 * @param mixed $value Raw parameter value.
	 * @return bool
	 */
	public function validate_month( $value ) {
		return is_string( $value )
			&& 1 === preg_match( self::MONTH_PATTERN, $value, $matches )
			&& (int) $matches[1] >= 2000;
	}

	/**
	 * Return paid-transaction figures for one month, grouped by currency.
	 *
	 * Months are attributed by transaction creation time (UTC) and include
	 * only paid transactions in the current payment mode. Commissions are
	 * summed as recorded; a NULL fee is unknown and counted as missing rather
	 * than treated as zero. The table is queried on every request so fees
	 * recorded later show up when a month is revisited.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_monthly_summary( $request ) {
		global $wpdb;

		$table    = Schema::get_payments_table_name();
		$testmode = 'test' === get_option( 'fair_payment_mode', 'test' ) ? 1 : 0;
		$month    = $request->get_param( 'month' );
		if ( ! $month ) {
			$month = gmdate( 'Y-m' );
		}

		// Half-open range: [first day of month, first day of next month).
		$month_start = $month . '-01 00:00:00';
		$month_end   = gmdate( 'Y-m-01 00:00:00', strtotime( $month_start . ' UTC +1 month' ) );

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT currency,
					COUNT(*) AS transaction_count,
					COALESCE(SUM(amount), 0) AS paid_total,
					COALESCE(SUM(application_fee), 0) AS fair_event_commission,
					COALESCE(SUM(mollie_fee), 0) AS mollie_commission,
					SUM(application_fee IS NULL) AS missing_fair_event_commission_count,
					SUM(mollie_fee IS NULL) AS missing_mollie_commission_count
				FROM %i
				WHERE status = %s AND testmode = %d AND created_at >= %s AND created_at < %s
				GROUP BY currency
				ORDER BY currency ASC',
				$table,
				'paid',
				$testmode,
				$month_start,
				$month_end
			),
			ARRAY_A
		);

		$currencies = array_map( array( $this, 'format_currency_row' ), $rows ? $rows : array() );

		if ( empty( $currencies ) ) {
			$currencies[] = $this->format_currency_row(
				array( 'currency' => Money::site_currency() )
			);
		}

		return new WP_REST_Response(
			array(
				'month'      => $month,
				'testmode'   => (bool) $testmode,
				'currencies' => $currencies,
			),
			200
		);
	}

	/**
	 * Shape one aggregated currency row for the response.
	 *
	 * @param array $row Aggregated row; missing keys default to zero.
	 * @return array
	 */
	private function format_currency_row( $row ) {
		$paid_total            = round( (float) ( $row['paid_total'] ?? 0 ), 2 );
		$fair_event_commission = round( (float) ( $row['fair_event_commission'] ?? 0 ), 2 );
		$mollie_commission     = round( (float) ( $row['mollie_commission'] ?? 0 ), 2 );
		$missing_fair_event    = (int) ( $row['missing_fair_event_commission_count'] ?? 0 );
		$missing_mollie        = (int) ( $row['missing_mollie_commission_count'] ?? 0 );

		return array(
			'currency'                            => (string) $row['currency'],
			'transaction_count'                   => (int) ( $row['transaction_count'] ?? 0 ),
			'paid_total'                          => $paid_total,
			'fair_event_commission'               => $fair_event_commission,
			'mollie_commission'                   => $mollie_commission,
			'amount_after_fees'                   => round( $paid_total - $fair_event_commission - $mollie_commission, 2 ),
			'missing_fair_event_commission_count' => $missing_fair_event,
			'missing_mollie_commission_count'     => $missing_mollie,
			'fair_event_commission_complete'      => 0 === $missing_fair_event,
			'mollie_commission_complete'          => 0 === $missing_mollie,
			'amount_after_fees_complete'          => 0 === $missing_fair_event && 0 === $missing_mollie,
		);
	}
}
