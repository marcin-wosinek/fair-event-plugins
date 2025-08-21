<?php
/**
 * Block registration hooks for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Hooks;

use FairPayment\Services\CurrencyService;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress block registration and hooks
 */
class BlockHooks {

	/**
	 * Currency service instance
	 *
	 * @var CurrencyService
	 */
	private $currency_service;

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		$this->currency_service = new CurrencyService();
		add_action( 'init', array( $this, 'register_blocks' ) );
	}

	/**
	 * Register simple payment block type
	 *
	 * @return void
	 */
	public function register_blocks() {
		register_block_type( __DIR__ . '/../../build/blocks/simple-payment' );
	}
}
