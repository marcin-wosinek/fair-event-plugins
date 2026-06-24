<?php
/**
 * Admin Hooks
 *
 * @package FairForm
 */

namespace FairForm\Admin;

defined( 'WPINC' ) || die;

/**
 * Admin hooks for menu and script registration.
 */
class AdminHooks {

	/**
	 * Hidden submenu pages configuration.
	 *
	 * WordPress can't find hidden pages (empty parent slug) in the menu structure,
	 * causing PHP 8.1+ deprecation warnings. This configuration is used to:
	 * - Register the pages
	 * - Set proper titles to prevent strip_tags() warnings
	 * - Set parent_file/submenu_file to prevent null value warnings
	 *
	 * @var array<string, array{title: string, callback: string}>
	 */
	private const HIDDEN_PAGES = array(
		'fair-form-questionnaire-responses' => array(
			'title'    => 'Questionnaire Responses',
			'callback' => 'render_questionnaire_responses_page',
		),
		'fair-form-submission-detail'       => array(
			'title'    => 'Submission Detail',
			'callback' => 'render_submission_detail_page',
		),
	);

	/**
	 * Constructor.
	 */
	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
		add_action( 'current_screen', array( $this, 'set_title_for_hidden_pages' ) );
		add_filter( 'parent_file', array( $this, 'fix_parent_file_for_hidden_pages' ) );
		add_filter( 'submenu_file', array( $this, 'fix_submenu_file_for_hidden_pages' ), 10, 2 );
	}

	/**
	 * Check if current page is a hidden page.
	 *
	 * @return bool True if current page is hidden.
	 */
	private function is_hidden_page(): bool {
		global $plugin_page;
		return isset( self::HIDDEN_PAGES[ $plugin_page ] );
	}

	/**
	 * Fix parent_file for hidden submenu pages to prevent PHP 8.1+ deprecation warnings.
	 *
	 * @param string|null $parent_file The parent file.
	 * @return string The parent file (never null).
	 */
	public function fix_parent_file_for_hidden_pages( $parent_file ) {
		if ( $this->is_hidden_page() ) {
			return 'fair-form';
		}
		return $parent_file ?? '';
	}

	/**
	 * Fix submenu_file for hidden submenu pages to prevent PHP 8.1+ deprecation warnings.
	 *
	 * @param string|null $submenu_file The submenu file.
	 * @param string      $parent_file  The parent file.
	 * @return string The submenu file (never null).
	 */
	public function fix_submenu_file_for_hidden_pages( $submenu_file, $parent_file ) {
		global $plugin_page;

		if ( $this->is_hidden_page() ) {
			return $plugin_page;
		}
		return $submenu_file ?? '';
	}

	/**
	 * Set the admin page title for hidden pages to prevent PHP 8.1+ deprecation warnings.
	 */
	public function set_title_for_hidden_pages() {
		global $plugin_page, $title;

		if ( isset( self::HIDDEN_PAGES[ $plugin_page ] ) && empty( $title ) ) {
			$title = __( self::HIDDEN_PAGES[ $plugin_page ]['title'], 'fair-form' );
		}
	}

	/**
	 * Register a hidden submenu page using the HIDDEN_PAGES configuration.
	 *
	 * @param string $menu_slug The menu slug for the hidden page.
	 */
	private function register_hidden_page( string $menu_slug ): void {
		if ( ! isset( self::HIDDEN_PAGES[ $menu_slug ] ) ) {
			return;
		}

		$config = self::HIDDEN_PAGES[ $menu_slug ];
		$title  = __( $config['title'], 'fair-form' );

		add_submenu_page(
			'', // Hidden from menu.
			$title,
			$title,
			'manage_options',
			$menu_slug,
			array( $this, $config['callback'] )
		);
	}

	/**
	 * Register admin menu pages.
	 */
	public function register_admin_menu() {
		// Main menu page — landing is the Answers Overview.
		add_menu_page(
			__( 'Fair Form', 'fair-form' ),
			__( 'Fair Form', 'fair-form' ),
			'manage_options',
			'fair-form',
			array( $this, 'render_answers_overview_page' ),
			'dashicons-feedback',
			'20.4'
		);

		// First visible submenu overrides the auto-generated duplicate.
		add_submenu_page(
			'fair-form',
			__( 'Answers Overview', 'fair-form' ),
			__( 'Answers Overview', 'fair-form' ),
			'manage_options',
			'fair-form',
			array( $this, 'render_answers_overview_page' )
		);

		// Visible submenu — flat list of all answers.
		add_submenu_page(
			'fair-form',
			__( 'All Answers', 'fair-form' ),
			__( 'All Answers', 'fair-form' ),
			'manage_options',
			'fair-form-form-answers',
			array( $this, 'render_form_answers_page' )
		);

		// Hidden submenu page - Questionnaire Responses.
		$this->register_hidden_page( 'fair-form-questionnaire-responses' );

		// Hidden submenu page - Submission Detail.
		$this->register_hidden_page( 'fair-form-submission-detail' );
	}

	/**
	 * Render Answers Overview page.
	 */
	public function render_answers_overview_page() {
		$page = new AnswersOverviewPage();
		$page->render();
	}

	/**
	 * Render Form Answers page.
	 */
	public function render_form_answers_page() {
		$page = new FormAnswersPage();
		$page->render();
	}

	/**
	 * Render Questionnaire Responses page.
	 */
	public function render_questionnaire_responses_page() {
		$page = new QuestionnaireResponsesPage();
		$page->render();
	}

	/**
	 * Render Submission Detail page.
	 */
	public function render_submission_detail_page() {
		$page = new SubmissionDetailPage();
		$page->render();
	}

	/**
	 * Enqueue admin scripts.
	 *
	 * @param string $hook Page hook.
	 */
	public function enqueue_admin_scripts( $hook ) {
		$plugin_dir = plugin_dir_path( dirname( __DIR__ ) );

		// Answers Overview page (top-level, hook is toplevel_page_fair-form).
		if ( 'toplevel_page_fair-form' === $hook ) {
			$this->enqueue_page_script( 'answers-overview', $plugin_dir );
		}

		// All Answers flat list page.
		if ( 'fair-form_page_fair-form-form-answers' === $hook ) {
			$this->enqueue_page_script( 'form-answers', $plugin_dir );
		}

		// Questionnaire Responses page.
		if ( 'admin_page_fair-form-questionnaire-responses' === $hook ) {
			$this->enqueue_page_script( 'questionnaire-responses', $plugin_dir );
		}

		// Submission Detail page.
		if ( 'admin_page_fair-form-submission-detail' === $hook ) {
			$this->enqueue_page_script( 'submission-detail', $plugin_dir );
		}
	}

	/**
	 * Enqueue page script.
	 *
	 * @param string $page_name  Page name.
	 * @param string $plugin_dir Plugin directory path.
	 */
	private function enqueue_page_script( $page_name, $plugin_dir ) {
		$asset_file = $plugin_dir . "build/admin/{$page_name}/index.asset.php";

		if ( file_exists( $asset_file ) ) {
			$asset_data = include $asset_file;

			wp_enqueue_script(
				"fair-form-{$page_name}",
				plugin_dir_url( dirname( __DIR__ ) ) . "build/admin/{$page_name}/index.js",
				$asset_data['dependencies'],
				$asset_data['version'],
				true
			);

			wp_set_script_translations(
				"fair-form-{$page_name}",
				'fair-form',
				\FairForm\Core\Features::script_translations_path()
			);

			wp_enqueue_style( 'wp-components' );
		}
	}
}
