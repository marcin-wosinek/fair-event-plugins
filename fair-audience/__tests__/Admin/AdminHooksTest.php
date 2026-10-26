<?php
/**
 * AdminHooks hidden-page callback tests.
 *
 * WordPress leaves `$plugin_page` null on admin screens that aren't plugin
 * pages. Looking it up as an array offset is deprecated in PHP 8.5, so the
 * title and navigation callbacks must handle an absent page without notices
 * (#2085) while still recognizing the hidden participant pages.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Admin;

// The callbacks read WordPress's admin-page globals, which each test sets
// and tearDown() restores.
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

use FairAudience\Admin\AdminHooks;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for AdminHooks' hidden-page title and navigation callbacks.
 */
class AdminHooksTest extends TestCase {

	/**
	 * Globals the callbacks read or write, restored after each test.
	 */
	private const GLOBAL_NAMES = array( 'plugin_page', 'title' );

	/**
	 * Saved global values, keyed by name; absent keys were unset.
	 *
	 * @var array<string, mixed>
	 */
	private array $saved_globals = array();

	/**
	 * Subject under test.
	 *
	 * @var AdminHooks
	 */
	private AdminHooks $hooks;

	/**
	 * Save globals and build the subject.
	 */
	protected function setUp(): void {
		foreach ( self::GLOBAL_NAMES as $name ) {
			if ( array_key_exists( $name, $GLOBALS ) ) {
				$this->saved_globals[ $name ] = $GLOBALS[ $name ];
			}
		}
		$this->hooks = new AdminHooks();
	}

	/**
	 * Restore globals and recorded hook registrations.
	 */
	protected function tearDown(): void {
		foreach ( self::GLOBAL_NAMES as $name ) {
			if ( array_key_exists( $name, $this->saved_globals ) ) {
				$GLOBALS[ $name ] = $this->saved_globals[ $name ];
			} else {
				unset( $GLOBALS[ $name ] );
			}
		}
		$this->saved_globals = array();
		unset( $GLOBALS['_fair_test_hooks'] );
	}

	/**
	 * Set `$plugin_page`, or unset it when the case calls for that.
	 *
	 * @param bool        $is_set      Whether the global exists at all.
	 * @param string|null $plugin_page Value to set.
	 */
	private function set_plugin_page( bool $is_set, ?string $plugin_page ): void {
		if ( $is_set ) {
			$GLOBALS['plugin_page'] = $plugin_page;
		} else {
			unset( $GLOBALS['plugin_page'] );
		}
	}

	/**
	 * `$plugin_page` values that aren't Fair Audience hidden pages.
	 *
	 * @return array<string, array{0: bool, 1: string|null}>
	 */
	public static function unrelated_pages(): array {
		return array(
			'unset'                     => array( false, null ),
			'null'                      => array( true, null ),
			'empty string'              => array( true, '' ),
			'visible plugin page'       => array( true, 'fair-audience' ),
			'unrelated plugin page'     => array( true, 'some-other-plugin' ),
			'Fair Form responses page'  => array( true, 'fair-form-questionnaire-responses' ),
			'Fair Form submission page' => array( true, 'fair-form-submission-detail' ),
		);
	}

	/**
	 * Fair Audience hidden pages and their expected titles.
	 *
	 * @return array<string, array{0: string, 1: string}>
	 */
	public static function hidden_pages(): array {
		return array(
			'event participants' => array( 'fair-audience-event-participants', 'Event Participants' ),
			'participant detail' => array( 'fair-audience-participant-detail', 'Participant Detail' ),
		);
	}

	/**
	 * Fair Audience hidden page slugs.
	 *
	 * @return array<string, array{0: string}>
	 */
	public static function hidden_page_slugs(): array {
		return array_map(
			static function ( array $page ): array {
				return array( $page[0] );
			},
			self::hidden_pages()
		);
	}

	/**
	 * Unrelated pages leave an empty title alone.
	 *
	 * @param bool        $is_set      Whether `$plugin_page` exists.
	 * @param string|null $plugin_page `$plugin_page` value.
	 */
	#[DataProvider( 'unrelated_pages' )]
	public function test_title_is_untouched_on_unrelated_pages( bool $is_set, ?string $plugin_page ): void {
		$this->set_plugin_page( $is_set, $plugin_page );
		$GLOBALS['title'] = '';

		$this->hooks->set_title_for_hidden_pages();

		$this->assertSame( '', $GLOBALS['title'] );
	}

	/**
	 * Unrelated pages keep incoming navigation values, null becoming ''.
	 *
	 * @param bool        $is_set      Whether `$plugin_page` exists.
	 * @param string|null $plugin_page `$plugin_page` value.
	 */
	#[DataProvider( 'unrelated_pages' )]
	public function test_navigation_is_preserved_on_unrelated_pages( bool $is_set, ?string $plugin_page ): void {
		$this->set_plugin_page( $is_set, $plugin_page );

		$this->assertSame( '', $this->hooks->fix_parent_file_for_hidden_pages( null ) );
		$this->assertSame( 'edit.php', $this->hooks->fix_parent_file_for_hidden_pages( 'edit.php' ) );
		$this->assertSame( '', $this->hooks->fix_submenu_file_for_hidden_pages( null, 'edit.php' ) );
		$this->assertSame( 'edit.php?post_type=page', $this->hooks->fix_submenu_file_for_hidden_pages( 'edit.php?post_type=page', 'edit.php' ) );
	}

	/**
	 * Hidden pages get their title when none is set.
	 *
	 * @param string $plugin_page Hidden page slug.
	 * @param string $title       Expected title.
	 */
	#[DataProvider( 'hidden_pages' )]
	public function test_hidden_page_sets_empty_title( string $plugin_page, string $title ): void {
		$GLOBALS['plugin_page'] = $plugin_page;
		$GLOBALS['title']       = '';

		$this->hooks->set_title_for_hidden_pages();

		$this->assertSame( $title, $GLOBALS['title'] );
	}

	/**
	 * Hidden pages keep a title that is already set.
	 *
	 * @param string $plugin_page Hidden page slug.
	 */
	#[DataProvider( 'hidden_page_slugs' )]
	public function test_hidden_page_keeps_populated_title( string $plugin_page ): void {
		$GLOBALS['plugin_page'] = $plugin_page;
		$GLOBALS['title']       = 'Existing title';

		$this->hooks->set_title_for_hidden_pages();

		$this->assertSame( 'Existing title', $GLOBALS['title'] );
	}

	/**
	 * Hidden pages highlight the Fair Audience menu and their own submenu.
	 *
	 * @param string $plugin_page Hidden page slug.
	 */
	#[DataProvider( 'hidden_page_slugs' )]
	public function test_hidden_page_selects_plugin_navigation( string $plugin_page ): void {
		$GLOBALS['plugin_page'] = $plugin_page;

		$this->assertSame( 'fair-audience', $this->hooks->fix_parent_file_for_hidden_pages( null ) );
		$this->assertSame( 'fair-audience', $this->hooks->fix_parent_file_for_hidden_pages( 'edit.php' ) );
		$this->assertSame( $plugin_page, $this->hooks->fix_submenu_file_for_hidden_pages( null, 'fair-audience' ) );
		$this->assertSame( $plugin_page, $this->hooks->fix_submenu_file_for_hidden_pages( 'edit.php', 'fair-audience' ) );
	}
}
