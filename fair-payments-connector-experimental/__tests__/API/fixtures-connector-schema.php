<?php
/**
 * Stand-in for Fair Payments Connector's Schema, which this plugin's tests
 * cannot autoload. Mirrors only the API tokens table name.
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnector\Database;

if ( ! class_exists( Schema::class ) ) {
	/**
	 * Table names of Fair Payments Connector.
	 */
	class Schema {

		/**
		 * API tokens table name.
		 *
		 * @return string
		 */
		public static function get_api_tokens_table_name() {
			global $wpdb;
			return $wpdb->prefix . 'fair_payment_api_tokens';
		}
	}
}
