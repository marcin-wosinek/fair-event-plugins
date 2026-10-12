<?php
/**
 * Custom Mail Message Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\CustomMailMessage;

defined( 'WPINC' ) || die;

/**
 * Repository for custom mail message data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class CustomMailMessageRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_custom_mail_messages';
	}

	/**
	 * Get all custom mail messages.
	 *
	 * @return CustomMailMessage[] Array of custom mail messages.
	 */
	public function get_all() {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i ORDER BY created_at DESC',
				$table_name
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new CustomMailMessage( $row );
			},
			$results
		);
	}

	/**
	 * Get custom mail message by ID.
	 *
	 * @param int $id Message ID.
	 * @return CustomMailMessage|null Message or null if not found.
	 */
	public function get_by_id( $id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d',
				$table_name,
				$id
			),
			ARRAY_A
		);

		return $result ? new CustomMailMessage( $result ) : null;
	}

	/**
	 * Delete custom mail message by ID.
	 *
	 * @param int $id Message ID.
	 * @return bool Success.
	 */
	public function delete( $id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array( 'id' => $id ),
			array( '%d' )
		) !== false;
	}
}
