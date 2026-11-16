<?php
/**
 * Bank account model for Fair Finance
 *
 * @package FairFinance
 */

namespace FairFinance\Models;

use FairFinance\Database\Schema;

defined( 'WPINC' ) || die;

/**
 * A bank account that imported entries can reference.
 *
 * Only a stable identity and a display name: no credentials, provider
 * details or import settings. Distinct from the payment-provider accounts
 * that settlement reconciliation records.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class BankAccount {

	/**
	 * Longest accepted display name, matching the column.
	 */
	const NAME_MAX_LENGTH = 255;

	/**
	 * Bank account ID
	 *
	 * @var int
	 */
	public $id;

	/**
	 * Display name
	 *
	 * @var string
	 */
	public $name;

	/**
	 * Created at timestamp
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Updated at timestamp
	 *
	 * @var string
	 */
	public $updated_at;

	/**
	 * Get bank account by ID
	 *
	 * @param int $id Bank account ID.
	 * @return BankAccount|null Bank account, or null if not found.
	 */
	public static function get_by_id( $id ) {
		global $wpdb;

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d LIMIT 1',
				Schema::get_bank_accounts_table_name(),
				$id
			)
		);

		return $result ? self::hydrate( $result ) : null;
	}

	/**
	 * Get every bank account, ordered by name
	 *
	 * @return BankAccount[]
	 */
	public static function get_all() {
		global $wpdb;

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i ORDER BY name ASC, id ASC',
				Schema::get_bank_accounts_table_name()
			)
		);

		return array_map( array( self::class, 'hydrate' ), $results ? $results : array() );
	}

	/**
	 * Create a bank account
	 *
	 * @param string $name Display name, already validated.
	 * @return int|false The new ID, or false on failure.
	 */
	public static function create( $name ) {
		global $wpdb;

		$result = $wpdb->insert(
			Schema::get_bank_accounts_table_name(),
			array( 'name' => $name ),
			array( '%s' )
		);

		return $result ? (int) $wpdb->insert_id : false;
	}

	/**
	 * Hydrate a bank account from a database row
	 *
	 * @param object $row Database row.
	 * @return BankAccount
	 */
	private static function hydrate( $row ) {
		$account             = new self();
		$account->id         = (int) $row->id;
		$account->name       = $row->name;
		$account->created_at = $row->created_at;
		$account->updated_at = $row->updated_at;
		return $account;
	}

	/**
	 * Convert to array
	 *
	 * @return array
	 */
	public function to_array() {
		return array(
			'id'         => $this->id,
			'name'       => $this->name,
			'created_at' => $this->created_at,
			'updated_at' => $this->updated_at,
		);
	}
}
