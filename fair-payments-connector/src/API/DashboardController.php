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
	 * Return current-month payment totals.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_monthly_summary( $request ) {
		global $wpdb;

		$table    = Schema::get_payments_table_name();
		$testmode = 'test' === get_option( 'fair_payment_mode', 'test' ) ? 1 : 0;
		$month    = gmdate( 'Y-m' );

		$month_start = gmdate( 'Y-m-01 00:00:00' );
		$month_end   = gmdate( 'Y-m-t 23:59:59' );

		$total_volume = (float) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT SUM(amount) FROM %i WHERE status = %s AND testmode = %d AND created_at BETWEEN %s AND %s',
				$table,
				'paid',
				$testmode,
				$month_start,
				$month_end
			)
		);

		$total_fees = (float) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT SUM(application_fee) FROM %i WHERE status IN (%s, %s) AND testmode = %d AND created_at BETWEEN %s AND %s',
				$table,
				'paid',
				'pending_payment',
				$testmode,
				$month_start,
				$month_end
			)
		);

		return new WP_REST_Response(
			array(
				'month'        => $month,
				'total_volume' => $total_volume,
				'total_fees'   => $total_fees,
				'testmode'     => (bool) $testmode,
			),
			200
		);
	}
}
